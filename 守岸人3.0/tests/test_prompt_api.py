from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.database import get_db
from server.middleware.auth import get_current_user
from server.models.persona import PromptPreset


@pytest.fixture
def prompt_api(db_session, seeded_chat):
    from server.routers import prompt_presets

    app = FastAPI()
    app.include_router(prompt_presets.router)
    app.include_router(prompt_presets.profiles_router)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: seeded_chat.owner
    return SimpleNamespace(client=TestClient(app), owner=seeded_chat.owner)


def test_preset_blocks_profile_and_safe_preview(prompt_api):
    preset = prompt_api.client.post(
        "/api/prompt-presets",
        json={"name": "Roleplay", "token_budget": 100},
    )
    assert preset.status_code == 200
    preset_id = preset.json()["id"]

    block = prompt_api.client.post(
        f"/api/prompt-presets/{preset_id}/blocks",
        json={
            "kind": "system",
            "name": "Rules",
            "content": "Stay in character",
            "sort_order": 0,
        },
    )
    assert block.status_code == 200

    profile = prompt_api.client.post(
        "/api/model-profiles",
        json={
            "name": "DeepSeek",
            "provider": "siliconflow",
            "model": "deepseek-v4-flash",
            "prompt_preset_id": preset_id,
            "parameters": {"temperature": 0.8, "max_tokens": 2048},
        },
    )
    assert profile.status_code == 200
    assert "api_key" not in profile.json()

    preview = prompt_api.client.post(
        "/api/prompt-presets/preview",
        json={
            "preset_id": preset_id,
            "metadata": {"model": "deepseek-v4-flash", "api_key": "secret"},
        },
    )
    assert preview.status_code == 200
    assert preview.json()["metadata"] == {"model": "deepseek-v4-flash"}
    assert "secret" not in preview.text


def test_model_profile_rejects_secret_and_unknown_parameters(prompt_api):
    response = prompt_api.client.post(
        "/api/model-profiles",
        json={
            "name": "Unsafe",
            "provider": "siliconflow",
            "model": "x",
            "parameters": {"api_key": "secret"},
        },
    )
    assert response.status_code == 422


def test_preset_access_is_owner_scoped(prompt_api, db_session):
    foreign = PromptPreset(
        id="foreign-preset",
        user_id="foreign-user",
        name="Foreign",
        token_budget=100,
    )
    db_session.add(foreign)
    db_session.commit()

    response = prompt_api.client.get("/api/prompt-presets/foreign-preset")
    assert response.status_code == 404


def test_block_reorder_is_atomic_and_deterministic(prompt_api):
    preset = prompt_api.client.post(
        "/api/prompt-presets",
        json={"name": "Ordered", "token_budget": 100},
    ).json()
    first = prompt_api.client.post(
        f"/api/prompt-presets/{preset['id']}/blocks",
        json={"kind": "system", "name": "First", "content": "A", "sort_order": 0},
    ).json()
    second = prompt_api.client.post(
        f"/api/prompt-presets/{preset['id']}/blocks",
        json={"kind": "final", "name": "Second", "content": "B", "sort_order": 1},
    ).json()

    response = prompt_api.client.put(
        f"/api/prompt-presets/{preset['id']}/blocks/reorder",
        json={"block_ids": [second["id"], first["id"]]},
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [second["id"], first["id"]]
