import json
from pathlib import Path

from cryptography.fernet import Fernet
import httpx
import pytest

from app.config import Settings
from app.domain.model_profiles import ModelProfileCreate
from app.gateway import create_gateway_app
from app.gateway_main import build_gateway_app
from app.integrations.model_providers import OpenAICompatibleProviderClient
from app.repositories.model_profiles import ModelProfileRepository
from app.security.route_tokens import InvalidRouteToken, RouteTokenIssuer
from app.security.secrets import FernetSecretStore
from app.services.model_profiles import ModelProfileService


def test_route_token_binds_task_profile_model_and_expiry() -> None:
    issuer = RouteTokenIssuer("signing-secret", clock=lambda: 1000)
    token = issuer.issue(
        task_id="t1",
        profile_id="p1",
        owner_id="local",
        model="m1",
        ttl_seconds=300,
    )

    claims = issuer.verify(token, task_id="t1", model="m1")

    assert claims.profile_id == "p1"
    with pytest.raises(InvalidRouteToken):
        issuer.verify(token, task_id="t2", model="m1")
    with pytest.raises(InvalidRouteToken):
        issuer.verify(token, task_id="t1", model="m2")

    expired_issuer = RouteTokenIssuer("signing-secret", clock=lambda: 1301)
    with pytest.raises(InvalidRouteToken):
        expired_issuer.verify(token, task_id="t1", model="m1")


def test_gateway_process_entrypoint_builds_private_app(tmp_path: Path) -> None:
    settings = Settings(
        data_dir=tmp_path,
        catalyst_report_path=tmp_path / "cat.json",
        user_strategy_snapshot_path=tmp_path / "strategy.json",
        model_master_key=Fernet.generate_key().decode("ascii"),
        gateway_service_token="internal-service",
        route_signing_key="signing-secret",
    )

    application = build_gateway_app(settings=settings, environment={})

    assert application.title == "Star Dominion Internal Model Gateway"
    assert application.docs_url is None
    assert application.openapi_url is None


@pytest.mark.asyncio
async def test_gateway_replaces_authorization_and_never_returns_secret(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "analysis"}}]},
        )

    app, profile_id, token = _gateway_harness(
        tmp_path,
        httpx.MockTransport(handler),
        task_id="task-1",
        model="model-a",
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://gateway"
    ) as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={
                "Authorization": "Bearer browser-supplied-value",
                "X-Stock-Service-Token": "internal-service",
                "X-Stock-Model-Route": token,
                "X-Stock-Analysis-Task": "task-1",
            },
            json={"model": "model-a", "messages": [{"role": "user", "content": "ping"}]},
        )

    assert response.status_code == 200
    headers = captured["headers"]
    assert isinstance(headers, httpx.Headers)
    assert headers["Authorization"] == "Bearer personal-secret"
    assert "browser-supplied-value" not in json.dumps(captured, default=str)
    assert captured["payload"]["model"] == "model-a"
    assert "personal-secret" not in response.text
    assert "personal-secret" not in caplog.text
    assert profile_id


@pytest.mark.asyncio
async def test_gateway_rejects_wrong_service_task_and_model(tmp_path: Path) -> None:
    app, _, token = _gateway_harness(
        tmp_path,
        httpx.MockTransport(lambda _: httpx.Response(200, json={})),
        task_id="task-1",
        model="model-a",
    )
    base_headers = {
        "X-Stock-Service-Token": "internal-service",
        "X-Stock-Model-Route": token,
        "X-Stock-Analysis-Task": "task-1",
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://gateway"
    ) as client:
        wrong_service = await client.post(
            "/v1/chat/completions",
            headers={**base_headers, "X-Stock-Service-Token": "wrong"},
            json={"model": "model-a", "messages": []},
        )
        wrong_task = await client.post(
            "/v1/chat/completions",
            headers={**base_headers, "X-Stock-Analysis-Task": "task-2"},
            json={"model": "model-a", "messages": []},
        )
        wrong_model = await client.post(
            "/v1/chat/completions",
            headers=base_headers,
            json={"model": "model-b", "messages": []},
        )

    assert wrong_service.status_code == 401
    assert wrong_task.status_code == 401
    assert wrong_model.status_code == 401


@pytest.mark.asyncio
async def test_gateway_streams_event_response(tmp_path: Path) -> None:
    stream_body = b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    app, _, token = _gateway_harness(
        tmp_path,
        httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                content=stream_body,
                headers={"Content-Type": "text/event-stream"},
            )
        ),
        task_id="task-stream",
        model="model-a",
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://gateway"
    ) as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={
                "X-Stock-Service-Token": "internal-service",
                "X-Stock-Model-Route": token,
                "X-Stock-Analysis-Task": "task-stream",
            },
            json={"model": "model-a", "messages": [], "stream": True},
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.content == stream_body


@pytest.mark.asyncio
async def test_gateway_accepts_adapter_headers_without_separate_task_header(tmp_path: Path) -> None:
    app, _, token = _gateway_harness(
        tmp_path,
        httpx.MockTransport(lambda _: httpx.Response(200, json={"choices": []})),
        task_id="task-from-signed-token",
        model="model-a",
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://gateway"
    ) as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={
                "X-Stock-Service-Token": "internal-service",
                "X-Stock-Model-Route": token,
            },
            json={"model": "model-a", "messages": []},
        )

    assert response.status_code == 200


def _gateway_harness(
    tmp_path: Path,
    transport: httpx.AsyncBaseTransport,
    *,
    task_id: str,
    model: str,
) -> tuple[object, str, str]:
    repository = ModelProfileRepository(tmp_path / "hub.db")
    secret_store = FernetSecretStore(repository, Fernet.generate_key().decode("ascii"))
    provider = OpenAICompatibleProviderClient(
        transport=transport,
        resolver=lambda _: ["93.184.216.34"],
        production=True,
    )
    profiles = ModelProfileService(
        repository,
        secret_store,
        owner_id="local",
        provider_client=provider,
    )
    profile = profiles.create(
        ModelProfileCreate.siliconflow(name="SF", api_key="personal-secret")
    )
    settings = Settings(
        data_dir=tmp_path,
        catalyst_report_path=tmp_path / "cat.json",
        user_strategy_snapshot_path=tmp_path / "strategy.json",
        gateway_service_token="internal-service",
        route_signing_key="signing-secret",
    )
    issuer = RouteTokenIssuer(settings.route_signing_key, clock=lambda: 1000)
    token = issuer.issue(
        task_id=task_id,
        profile_id=profile.id,
        owner_id="local",
        model=model,
        ttl_seconds=300,
    )
    app = create_gateway_app(
        settings=settings,
        profiles=profiles,
        provider_client=provider,
        route_issuer=issuer,
    )
    return app, profile.id, token
