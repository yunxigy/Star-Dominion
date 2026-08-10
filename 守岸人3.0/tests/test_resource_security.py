from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from server.database import get_db
from server.middleware.auth import get_current_user
from server.models.character_db import CharacterDB
from server.models.chat_db import ChatSession
from server.models.lorebook import (
    Lorebook,
    LorebookActivationEvent,
    LorebookBinding,
    LorebookEntry,
)
from server.models.story import Story, StorySession
from server.models.user import User


@pytest.fixture
def resource_graph(db_session):
    owner = User(
        id="resource-owner",
        site_user_id="site-resource-owner",
        username="resource-owner",
        email="resource-owner@example.com",
        password_hash="!site-auth-only!",
        role="user",
    )
    other = User(
        id="resource-other",
        site_user_id="site-resource-other",
        username="resource-other",
        email="resource-other@example.com",
        password_hash="!site-auth-only!",
        role="user",
    )
    admin = User(
        id="resource-admin",
        site_user_id="site-resource-admin",
        username="resource-admin",
        email="resource-admin@example.com",
        password_hash="!site-auth-only!",
        role="admin",
    )
    private_character = CharacterDB(
        id="private-character",
        user_id=owner.id,
        creator_id=owner.id,
        name="Private Character",
        is_public=False,
    )
    public_character = CharacterDB(
        id="public-character",
        user_id=owner.id,
        creator_id=owner.id,
        name="Public Character",
        is_public=True,
    )
    story = Story(
        id="resource-story",
        title="Resource Story",
        background="Background",
        task="Task",
        system_prompt="Prompt",
        creator_id=owner.id,
    )
    story_session = StorySession(
        id="resource-story-session",
        user_id=owner.id,
        story_id=story.id,
    )
    chat_session = ChatSession(
        id="resource-chat-session",
        user_id=owner.id,
        character_id=public_character.id,
        version=1,
    )
    lorebook = Lorebook(
        id="resource-lorebook",
        character_id=public_character.id,
        name="Public Lorebook",
    )
    entry = LorebookEntry(
        id="resource-entry",
        lorebook_id=lorebook.id,
        keyword="shore",
        content="Black Shores",
    )
    db_session.add_all(
        [
            owner,
            other,
            admin,
            private_character,
            public_character,
            story,
            story_session,
            chat_session,
            lorebook,
            entry,
        ]
    )
    db_session.commit()
    return SimpleNamespace(
        owner=owner,
        other=other,
        admin=admin,
        private_character=private_character,
        public_character=public_character,
        story_session=story_session,
        chat_session=chat_session,
        lorebook=lorebook,
        entry=entry,
    )


def test_resource_access_hides_unowned_private_resources(db_session, resource_graph):
    from server.services.resource_access import require_readable_character

    with pytest.raises(HTTPException) as captured:
        require_readable_character(
            db_session,
            resource_graph.other,
            resource_graph.private_character.id,
        )

    assert captured.value.status_code == 404


def test_resource_access_allows_public_read_but_not_edit(db_session, resource_graph):
    from server.services.resource_access import (
        require_editable_character,
        require_readable_character,
    )

    readable = require_readable_character(
        db_session,
        resource_graph.other,
        resource_graph.public_character.id,
    )
    assert readable.id == resource_graph.public_character.id
    with pytest.raises(HTTPException) as captured:
        require_editable_character(
            db_session,
            resource_graph.other,
            resource_graph.public_character.id,
        )
    assert captured.value.status_code == 404


def test_resource_access_scopes_story_and_lorebook_resources(db_session, resource_graph):
    from server.services.resource_access import (
        require_editable_lorebook,
        require_editable_lorebook_entry,
        require_owned_story_session,
        require_readable_lorebook,
    )

    assert (
        require_owned_story_session(
            db_session,
            resource_graph.owner,
            resource_graph.story_session.id,
        ).id
        == resource_graph.story_session.id
    )
    with pytest.raises(HTTPException):
        require_owned_story_session(
            db_session,
            resource_graph.other,
            resource_graph.story_session.id,
        )

    assert (
        require_readable_lorebook(
            db_session,
            resource_graph.other,
            resource_graph.lorebook.id,
        ).id
        == resource_graph.lorebook.id
    )
    with pytest.raises(HTTPException):
        require_editable_lorebook(
            db_session,
            resource_graph.other,
            resource_graph.lorebook.id,
        )
    with pytest.raises(HTTPException):
        require_editable_lorebook_entry(
            db_session,
            resource_graph.other,
            resource_graph.entry.id,
        )

    assert (
        require_editable_lorebook_entry(
            db_session,
            resource_graph.admin,
            resource_graph.entry.id,
        ).id
        == resource_graph.entry.id
    )


def test_lorebook_entry_persists_priority(db_session, resource_graph):
    entry = LorebookEntry(
        id="priority-entry",
        lorebook_id=resource_graph.lorebook.id,
        keyword="priority",
        content="Priority content",
        priority=7,
    )
    db_session.add(entry)
    db_session.commit()
    db_session.refresh(entry)

    assert entry.priority == 7
    assert entry.to_dict()["priority"] == 7


def test_lorebook_advanced_fields_bindings_and_activation_event(
    db_session,
    resource_graph,
):
    book = resource_graph.lorebook
    entry = resource_graph.entry
    book.token_budget = 900
    book.recursive_scan = True
    book.max_recursion_steps = 4
    entry.sticky = 3
    entry.delay = 2
    entry.revision = 5
    event = LorebookActivationEvent(
        session_id=resource_graph.chat_session.id,
        entry_id=entry.id,
        response_message_id="response-1",
        entry_revision=5,
        trigger_sequence=8,
        sticky=3,
        cooldown=2,
    )
    chat_binding = LorebookBinding(
        lorebook_id=book.id,
        scope_type="chat",
        scope_id=resource_graph.chat_session.id,
    )
    persona_binding = LorebookBinding(
        lorebook_id=book.id,
        scope_type="persona",
        scope_id="reserved-persona-id",
    )
    db_session.add_all([event, chat_binding, persona_binding])
    db_session.commit()

    assert book.to_dict()["token_budget"] == 900
    assert entry.to_dict()["sticky"] == 3
    assert event.entry_revision == 5
    assert chat_binding.scope_type == "chat"
    assert persona_binding.scope_type == "persona"


@pytest.fixture
def story_api(db_session, resource_graph):
    from server.routers import story as story_router

    app = FastAPI()
    app.include_router(story_router.router)
    identity = SimpleNamespace(user=resource_graph.owner)

    def override_db():
        yield db_session

    async def override_current_user():
        return identity.user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_current_user
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, identity=identity)


@pytest.fixture
def anonymous_story_client(db_session):
    from server.routers import story as story_router

    app = FastAPI()
    app.include_router(story_router.router)

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as client:
        yield client


@pytest.fixture
def lorebook_api(db_session, resource_graph):
    from server.routers import lorebook as lorebook_router

    app = FastAPI()
    app.include_router(lorebook_router.router)
    identity = SimpleNamespace(user=resource_graph.owner)

    def override_db():
        yield db_session

    async def override_current_user():
        return identity.user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_current_user
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, identity=identity)


@pytest.fixture
def legacy_character_api(db_session, resource_graph, tmp_path, monkeypatch):
    from server.models.character import Character
    from server.routers import characters as characters_router

    characters_dir = tmp_path / "characters"
    voices_dir = tmp_path / "voices"
    legacy = Character(id="legacy-character", name="Legacy")
    legacy.save(characters_dir)
    monkeypatch.setattr(characters_router, "characters_dir", characters_dir)
    monkeypatch.setattr(characters_router, "voices_dir", voices_dir)

    app = FastAPI()
    app.include_router(characters_router.router)
    identity = SimpleNamespace(user=resource_graph.other)

    def override_db():
        yield db_session

    async def override_current_user():
        return identity.user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_current_user
    with TestClient(app) as client:
        yield SimpleNamespace(
            client=client,
            identity=identity,
            path=characters_dir / "legacy-character.json",
        )


@pytest.fixture
def affinity_api(db_session, resource_graph):
    from server.routers import affinity as affinity_router

    app = FastAPI()
    app.include_router(affinity_router.router)
    identity = SimpleNamespace(user=resource_graph.other)

    def override_db():
        yield db_session

    async def override_current_user():
        return identity.user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_current_user
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, identity=identity)


@pytest.mark.parametrize("suffix", ["", "/messages"])
def test_story_session_reads_require_login(
    anonymous_story_client,
    resource_graph,
    suffix,
):
    response = anonymous_story_client.get(
        f"/api/stories/sessions/{resource_graph.story_session.id}{suffix}"
    )
    assert response.status_code == 401


@pytest.mark.parametrize("suffix", ["", "/messages", "/branches"])
def test_story_session_reads_hide_other_users_sessions(
    story_api,
    resource_graph,
    suffix,
):
    story_api.identity.user = resource_graph.other
    response = story_api.client.get(
        f"/api/stories/sessions/{resource_graph.story_session.id}{suffix}"
    )
    assert response.status_code == 404


def test_story_export_does_not_include_other_users_sessions(
    story_api,
    resource_graph,
):
    story_api.identity.user = resource_graph.other
    response = story_api.client.get(
        f"/api/stories/{resource_graph.story_session.story_id}/export",
        params={"format": "json"},
    )

    assert response.status_code == 200
    assert response.json()["content"]["sessions"] == []


def test_public_lorebook_is_readable_but_not_writable_by_other_user(
    lorebook_api,
    resource_graph,
):
    lorebook_api.identity.user = resource_graph.other
    listed = lorebook_api.client.get(
        f"/api/lorebooks/character/{resource_graph.public_character.id}"
    )
    updated = lorebook_api.client.put(
        f"/api/lorebooks/{resource_graph.lorebook.id}",
        json={"name": "Hijacked"},
    )
    created = lorebook_api.client.post(
        f"/api/lorebooks/{resource_graph.lorebook.id}/entries",
        json={"keyword": "bad", "content": "bad"},
    )

    assert listed.status_code == 200
    assert updated.status_code == 404
    assert created.status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"keyword": "bad", "content": "bad", "position": "somewhere"},
        {"keyword": "bad", "content": "bad", "probability": 1.1},
        {"keyword": "bad", "content": "bad", "cooldown": -1},
    ],
)
def test_lorebook_entry_rejects_invalid_control_values(
    lorebook_api,
    resource_graph,
    payload,
):
    response = lorebook_api.client.post(
        f"/api/lorebooks/{resource_graph.lorebook.id}/entries",
        json=payload,
    )
    assert response.status_code == 422


def test_lorebook_entries_are_sorted_by_priority_then_order(
    lorebook_api,
    resource_graph,
):
    response = lorebook_api.client.post(
        f"/api/lorebooks/{resource_graph.lorebook.id}/entries",
        json={
            "keyword": "high",
            "content": "high",
            "priority": 8,
            "order": 3,
        },
    )
    assert response.status_code == 200

    listed = lorebook_api.client.get(
        f"/api/lorebooks/{resource_graph.lorebook.id}/entries"
    )
    assert listed.status_code == 200
    assert listed.json()[0]["keyword"] == "high"


def test_legacy_character_mutation_is_admin_only(
    legacy_character_api,
    resource_graph,
):
    denied = legacy_character_api.client.delete(
        "/api/characters/legacy-character"
    )
    assert denied.status_code == 403
    assert legacy_character_api.path.exists()

    legacy_character_api.identity.user = resource_graph.admin
    deleted = legacy_character_api.client.delete(
        "/api/characters/legacy-character"
    )
    assert deleted.status_code == 200
    assert not legacy_character_api.path.exists()


def test_manual_affinity_points_require_admin_and_bounded_points(
    affinity_api,
    resource_graph,
):
    path = f"/api/affinity/characters/{resource_graph.public_character.id}/add-points"
    denied = affinity_api.client.post(path, params={"points": 5})
    assert denied.status_code == 403

    affinity_api.identity.user = resource_graph.admin
    invalid = affinity_api.client.post(path, params={"points": -1})
    assert invalid.status_code == 422
