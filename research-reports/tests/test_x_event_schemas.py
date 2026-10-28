from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from research_reports.schemas import XEventIngestRequest


def valid_batch() -> dict:
    return {
        "provider": "fxtwitter",
        "modelProvider": "google",
        "modelName": "gemini-2.5-flash",
        "posts": [
            {
                "id": "post-1",
                "author": "OpenAI",
                "username": "OpenAI",
                "text": "A new AI model was announced.",
                "url": "https://x.com/OpenAI/status/post-1",
                "publishedAt": datetime.now(timezone.utc).isoformat(),
                "importance": 80,
            }
        ],
        "summary": {
            "title": "AI 圈大事",
            "summary": "本轮重点动态摘要。",
            "events": [
                {
                    "title": "发布新模型",
                    "summary": "OpenAI 宣布推出新模型。",
                    "importance": 80,
                    "postIds": ["post-1"],
                }
            ],
            "risks": ["模型能力尚未经过独立验证。"],
        },
    }


def test_x_event_ingest_schema_accepts_the_worker_contract() -> None:
    batch = XEventIngestRequest.model_validate(valid_batch())

    assert batch.posts[0].id == "post-1"
    assert batch.summary.events[0].post_ids == ["post-1"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["posts"][0].update(importance=101),
        lambda value: value["posts"][0].update(text="x" * 12_001),
        lambda value: value["posts"][0].update(url="http://x.com/post/1"),
        lambda value: value["posts"][0].update(publishedAt="2026-09-25T10:00:00"),
        lambda value: value.update(unexpected="field"),
        lambda value: value["summary"].update(unexpected="field"),
    ],
)
def test_x_event_ingest_schema_rejects_invalid_or_oversized_fields(mutate) -> None:
    payload = valid_batch()
    mutate(payload)

    with pytest.raises(ValidationError):
        XEventIngestRequest.model_validate(payload)


def test_x_event_ingest_schema_bounds_batch_and_summary_lists() -> None:
    payload = valid_batch()
    payload["posts"] = payload["posts"] * 101

    with pytest.raises(ValidationError):
        XEventIngestRequest.model_validate(payload)
