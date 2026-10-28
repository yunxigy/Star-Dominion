from datetime import datetime, timezone
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from research_reports.config import Settings
from research_reports.main import create_app


INGEST_TOKEN = "worker-ingest-secret-value"
IDEMPOTENCY_KEY = "x-" + "a" * 64


def _settings(tmp_path: Path, token: str | None = INGEST_TOKEN) -> Settings:
    environment = {
        "RESEARCH_REPORTS_DATA_DIR": str(tmp_path),
        "RESEARCH_REPORTS_TIMEZONE": "Asia/Shanghai",
        "RESEARCH_REPORTS_SITE_AUTH_URL": "http://site-auth.test",
        "SITE_AUTH_INTERNAL_KEY": "k" * 32,
    }
    if token is not None:
        environment["RESEARCH_REPORTS_X_INGEST_TOKEN"] = token
    return Settings.from_env(environment)


def _application(tmp_path: Path, token: str | None = INGEST_TOKEN):
    return create_app(settings=_settings(tmp_path, token), start_scheduler=False)


def _batch(post_ids: tuple[str, ...] = ("post-1",)) -> dict:
    posts = [
        {
            "id": post_id,
            "author": "OpenAI",
            "username": "OpenAI",
            "text": f"A substantive AI update {post_id}.",
            "url": f"https://x.com/OpenAI/status/{post_id}",
            "publishedAt": datetime.now(timezone.utc).isoformat(),
            "importance": 80,
        }
        for post_id in post_ids
    ]
    return {
        "provider": "fxtwitter",
        "modelProvider": "google",
        "modelName": "gemini-2.5-flash",
        "posts": posts,
        "summary": {
            "title": "AI 圈大事",
            "summary": "本轮 AI 领域重点动态。",
            "events": [
                {
                    "title": "模型进展",
                    "summary": "OpenAI 发布重要进展。",
                    "importance": 80,
                    "postIds": [post_ids[0]],
                }
            ],
            "risks": ["相关能力仍需验证。"],
        },
    }


def _ingest(client: TestClient, batch: dict, key: str = IDEMPOTENCY_KEY):
    return client.post(
        "/api/v1/ingest/x",
        json=batch,
        headers={
            "Authorization": "Bearer " + INGEST_TOKEN,
            "X-Idempotency-Key": key,
        },
    )


def test_x_ingest_requires_configured_bearer_token(tmp_path: Path) -> None:
    app = _application(tmp_path)
    with TestClient(app) as client:
        missing = client.post("/api/v1/ingest/x", json=_batch())
        wrong = client.post(
            "/api/v1/ingest/x",
            json=_batch(),
            headers={"Authorization": "Bearer wrong-value"},
        )

    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert INGEST_TOKEN not in missing.text + wrong.text


def test_x_ingest_fails_closed_when_server_token_is_not_configured(tmp_path: Path) -> None:
    app = _application(tmp_path, token=None)
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/ingest/x",
            json=_batch(),
            headers={"Authorization": "Bearer " + INGEST_TOKEN},
        )

    assert response.status_code == 503
    assert INGEST_TOKEN not in response.text


def test_valid_x_ingest_is_persisted_and_latest_endpoint_returns_linked_data(tmp_path: Path) -> None:
    app = _application(tmp_path)
    with TestClient(app) as client:
        response = _ingest(client, _batch(("post-1", "post-2")))
        latest = client.get("/api/v1/x-events/latest")

    assert response.status_code == 201
    assert response.json()["accepted"] == 2
    payload = latest.json()
    assert latest.status_code == 200
    assert payload["report"]["title"] == "AI 圈大事"
    assert payload["report"]["modelName"] == "gemini-2.5-flash"
    assert payload["report"]["events"][0]["postIds"] == ["post-1"]
    assert [post["externalId"] for post in payload["posts"]] == ["post-1", "post-2"]


def test_repeated_batch_and_cross_batch_posts_are_idempotent(tmp_path: Path) -> None:
    app = _application(tmp_path)
    with TestClient(app) as client:
        first = _ingest(client, _batch(("post-1", "post-2")))
        repeated = _ingest(client, _batch(("post-1", "post-2")))
        second = _ingest(client, _batch(("post-1", "post-3")), "x-" + "b" * 64)
        latest = client.get("/api/v1/x-events/latest")

    assert first.status_code == 201
    assert repeated.status_code == 200
    assert repeated.json()["duplicates"] == 2
    assert repeated.json()["reportId"] == first.json()["reportId"]
    assert second.status_code == 201
    assert second.json()["accepted"] == 1
    assert second.json()["duplicates"] == 1
    assert [post["externalId"] for post in latest.json()["posts"]] == ["post-1", "post-3"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["posts"][0].update(importance=101),
        lambda value: value["posts"][0].update(text="x" * 12_001),
        lambda value: value["posts"][0].update(url="http://x.com/OpenAI/status/post-1"),
        lambda value: value["summary"]["events"][0].update(postIds=["not-in-batch"]),
    ],
)
def test_invalid_x_batch_is_rejected_without_persisting_posts(tmp_path: Path, mutate) -> None:
    app = _application(tmp_path)
    payload = _batch()
    mutate(payload)
    with TestClient(app) as client:
        response = _ingest(client, payload)
        latest = client.get("/api/v1/x-events/latest")

    assert response.status_code == 422
    assert latest.json() == {"report": None, "posts": []}


def test_oversized_ingest_body_is_rejected(tmp_path: Path) -> None:
    app = _application(tmp_path)
    payload = _batch()
    payload["posts"][0]["text"] = "x" * 12_000
    encoded = json.dumps(payload).encode()
    body = encoded + b" " * (1_048_577 - len(encoded))
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/ingest/x",
            content=body,
            headers={
                "Authorization": "Bearer " + INGEST_TOKEN,
                "X-Idempotency-Key": IDEMPOTENCY_KEY,
                "Content-Type": "application/json",
            },
        )

    assert response.status_code == 413


def test_empty_latest_endpoint_has_stable_response_shape(tmp_path: Path) -> None:
    app = _application(tmp_path)
    with TestClient(app) as client:
        response = client.get("/api/v1/x-events/latest")

    assert response.status_code == 200
    assert response.json() == {"report": None, "posts": []}


def test_database_failure_does_not_leave_partial_x_event_data(tmp_path: Path, monkeypatch) -> None:
    app = _application(tmp_path)
    original_commit = Session.commit

    def fail_commit(session: Session) -> None:
        if session.bind is app.state.database.engine:
            raise RuntimeError("simulated database failure")
        original_commit(session)

    with TestClient(app, raise_server_exceptions=False) as client:
        monkeypatch.setattr(Session, "commit", fail_commit)
        response = _ingest(client, _batch())
        latest = client.get("/api/v1/x-events/latest")

    assert response.status_code == 500
    assert latest.json() == {"report": None, "posts": []}
