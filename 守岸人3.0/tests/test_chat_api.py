from __future__ import annotations

import json

from server.models.character_db import CharacterDB
from server.models.chat_db import ChatBranch, ChatMessage, ChatSession
from server.models.user import User


def test_history_returns_message_and_swipe_metadata(chat_client, seeded_chat):
    response = chat_client.get(
        "/api/chat/history",
        params={"session_id": seeded_chat.session.id},
    )

    assert response.status_code == 200
    message = response.json()[-1]
    assert message["id"] == seeded_chat.assistant_message.id
    assert message["role"] == "assistant"
    assert message["content"] == "你好，漂泊者"
    assert message["swipes"] == ["你好，漂泊者"]
    assert message["swipe_id"] == 0
    assert message["branch_id"] == seeded_chat.root_branch.id
    assert message["parent_message_id"] == seeded_chat.user_message.id
    assert message["edited_at"] is None


def test_regenerate_uses_only_context_before_target(
    chat_client,
    seeded_chat,
    fake_llm,
):
    response = chat_client.post(
        f"/api/chat/messages/{seeded_chat.assistant_message.id}/regenerate",
        data={"version": "1"},
    )

    assert response.status_code == 200
    assert [
        message["content"]
        for message in fake_llm.last_messages
        if message["role"] != "system"
    ] == ["你好"]
    assert response.json()["swipes"] == ["你好，漂泊者", "新的回答"]
    assert response.json()["swipe_id"] == 1


def test_regenerate_rejects_stale_session_version(chat_client, seeded_chat):
    response = chat_client.post(
        f"/api/chat/messages/{seeded_chat.assistant_message.id}/regenerate",
        data={"version": "0"},
    )

    assert response.status_code == 409


def test_new_session_starts_with_a_root_branch(db_session, seeded_chat):
    from server.routers.chat import _get_or_create_session

    character = CharacterDB(
        id="character-2",
        user_id=seeded_chat.user_id,
        creator_id=seeded_chat.user_id,
        name="另一个角色",
    )
    db_session.add(character)
    db_session.commit()

    session = _get_or_create_session(
        db_session,
        seeded_chat.user_id,
        character.id,
    )

    assert session.current_branch_id is not None
    branch = db_session.get(ChatBranch, session.current_branch_id)
    assert branch is not None
    assert branch.session_id == session.id
    assert branch.head_message_id is None


def test_chat_post_appends_messages_to_active_branch(
    chat_client,
    seeded_chat,
    db_session,
):
    from server.services.chat_history import ChatHistoryService

    response = chat_client.post(
        "/api/chat",
        data={
            "session_id": seeded_chat.session.id,
            "text": "再说一次",
            "tts_mode": "async",
        },
    )

    assert response.status_code == 200
    service = ChatHistoryService(db_session, owner_id=seeded_chat.user_id)
    path = service.active_path(seeded_chat.session.id)
    assert [message.role for message in path] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert path[-1].content["text"] == "新的回答"


def test_edit_api_creates_branch_and_lists_it(chat_client, seeded_chat):
    response = chat_client.patch(
        f"/api/chat/messages/{seeded_chat.user_message.id}",
        json={"content": "换个说法", "version": 1},
    )

    assert response.status_code == 200
    assert response.json()["message"]["content"] == "换个说法"
    assert response.json()["version"] == 2

    branches = chat_client.get(
        f"/api/chat/sessions/{seeded_chat.session.id}/branches"
    )
    assert branches.status_code == 200
    assert len(branches.json()["items"]) == 2
    assert sum(item["is_active"] for item in branches.json()["items"]) == 1


def test_branch_activation_restores_original_history(chat_client, seeded_chat):
    edit = chat_client.patch(
        f"/api/chat/messages/{seeded_chat.user_message.id}",
        json={"content": "换个说法", "version": 1},
    )
    assert edit.status_code == 200

    activate = chat_client.post(
        f"/api/chat/sessions/{seeded_chat.session.id}/branches/"
        f"{seeded_chat.root_branch.id}/activate",
        json={"version": 2},
    )

    assert activate.status_code == 200
    history = chat_client.get(
        "/api/chat/history",
        params={"session_id": seeded_chat.session.id},
    )
    assert [item["content"] for item in history.json()] == [
        "你好",
        "你好，漂泊者",
    ]


def test_checkpoint_api_lifecycle(chat_client, seeded_chat):
    created = chat_client.post(
        f"/api/chat/sessions/{seeded_chat.session.id}/checkpoints",
        json={
            "name": "第一次见面",
            "message_id": seeded_chat.user_message.id,
            "version": 1,
        },
    )
    assert created.status_code == 200
    checkpoint_id = created.json()["checkpoint"]["id"]
    assert created.json()["version"] == 2

    listed = chat_client.get(
        f"/api/chat/sessions/{seeded_chat.session.id}/checkpoints"
    )
    assert [item["id"] for item in listed.json()["items"]] == [checkpoint_id]

    restored = chat_client.post(
        f"/api/chat/checkpoints/{checkpoint_id}/restore",
        json={"version": 2},
    )
    assert restored.status_code == 200
    assert restored.json()["version"] == 3

    deleted = chat_client.request(
        "DELETE",
        f"/api/chat/checkpoints/{checkpoint_id}",
        json={"version": 3},
    )
    assert deleted.status_code == 200
    assert deleted.json()["version"] == 4


def test_delete_api_truncates_without_destroying_message(chat_client, seeded_chat):
    response = chat_client.request(
        "DELETE",
        f"/api/chat/messages/{seeded_chat.assistant_message.id}",
        json={"version": 1},
    )

    assert response.status_code == 200
    assert response.json()["version"] == 2
    history = chat_client.get(
        "/api/chat/history",
        params={"session_id": seeded_chat.session.id},
    )
    assert [item["role"] for item in history.json()] == ["user"]


def test_search_is_scoped_to_owner(chat_client, seeded_chat, db_session):
    other = User(
        id="other-user",
        username="other",
        email="other@example.com",
        password_hash="!site-auth-only!",
    )
    other_session = ChatSession(
        id="other-session",
        user_id=other.id,
        character_id=seeded_chat.character.id,
        current_branch_id="other-branch",
        head_message_id="other-message",
        version=1,
    )
    other_branch = ChatBranch(
        id="other-branch",
        session_id=other_session.id,
        head_message_id="other-message",
        name="主分支",
    )
    other_message = ChatMessage(
        id="other-message",
        session_id=other_session.id,
        role="assistant",
        content={"text": "你好，漂泊者"},
        swipes=["你好，漂泊者"],
        swipe_id="0",
        branch_id=other_branch.id,
        sequence=1,
    )
    db_session.add_all([other, other_session, other_branch, other_message])
    db_session.commit()

    response = chat_client.get("/api/chat/search", params={"q": "漂泊者"})

    assert response.status_code == 200
    assert {item["session_id"] for item in response.json()["items"]} == {
        seeded_chat.session.id
    }


def test_jsonl_export_contains_only_active_path(chat_client, seeded_chat):
    edited = chat_client.patch(
        f"/api/chat/messages/{seeded_chat.user_message.id}",
        json={"content": "活动分支内容", "version": 1},
    )
    assert edited.status_code == 200

    response = chat_client.get(
        "/api/chat/export",
        params={"session_id": seeded_chat.session.id},
    )

    assert response.status_code == 200
    lines = [json.loads(line) for line in response.text.splitlines() if line]
    assert [line["content"]["text"] for line in lines] == ["活动分支内容"]


def test_structural_change_writes_full_snapshot(
    chat_client,
    seeded_chat,
    chat_backup_root,
):
    response = chat_client.patch(
        f"/api/chat/messages/{seeded_chat.user_message.id}",
        json={"content": "自动备份", "version": 1},
    )

    assert response.status_code == 200
    snapshots = list(chat_backup_root.glob("*.json"))
    assert len(snapshots) == 1
    payload = json.loads(snapshots[0].read_text("utf-8"))
    assert payload["format"] == "shouanren-chat-backup"


def test_full_backup_download_and_import(chat_client, seeded_chat):
    exported = chat_client.get(
        f"/api/chat/sessions/{seeded_chat.session.id}/backup"
    )
    assert exported.status_code == 200
    payload = exported.json()
    assert payload["format"] == "shouanren-chat-backup"

    imported = chat_client.post(
        "/api/chat/backup/import",
        files={
            "file": (
                "chat-backup.json",
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                "application/json",
            )
        },
    )
    assert imported.status_code == 200
    assert imported.json()["message_count"] == payload["message_count"]


def test_clear_history_creates_empty_branch_without_deleting_messages(
    chat_client,
    seeded_chat,
    db_session,
):
    response = chat_client.request(
        "DELETE",
        "/api/chat/history",
        params={"session_id": seeded_chat.session.id},
        json={"version": 1},
    )

    assert response.status_code == 200
    assert response.json()["version"] == 2
    history = chat_client.get(
        "/api/chat/history",
        params={"session_id": seeded_chat.session.id},
    )
    assert history.json() == []
    assert db_session.get(ChatMessage, seeded_chat.user_message.id) is not None
