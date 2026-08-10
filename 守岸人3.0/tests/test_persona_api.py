from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.database import get_db
from server.middleware.auth import get_current_user


@pytest.fixture
def persona_api(db_session, seeded_chat):
    from server.routers import persona

    app = FastAPI(); app.include_router(persona.router)
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: seeded_chat.owner
    return SimpleNamespace(client=TestClient(app), owner=seeded_chat.owner)


def test_persona_crud_default_and_selection(persona_api, seeded_chat):
    created = persona_api.client.post("/api/personas", json={"name": "Rover", "description": "Traveler", "injection_position": "before_char"})
    assert created.status_code == 200
    persona_id = created.json()["id"]
    assert persona_api.client.put(f"/api/personas/default/{persona_id}").status_code == 200
    bound = persona_api.client.put(f"/api/personas/bindings/chat/{seeded_chat.session.id}", json={"persona_id": persona_id})
    assert bound.status_code == 200
    selected = persona_api.client.get("/api/personas/selection", params={"session_id": seeded_chat.session.id})
    assert (selected.json()["persona"]["id"], selected.json()["source"]) == (persona_id, "chat")
    assert persona_api.client.delete(f"/api/personas/{persona_id}").status_code == 200


def test_persona_payload_is_bounded(persona_api):
    response = persona_api.client.post("/api/personas", json={"name": "", "injection_position": "invalid"})
    assert response.status_code == 422
