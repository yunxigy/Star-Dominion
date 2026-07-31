from __future__ import annotations

from server.models.character_db import CharacterDB
from server.models.chat_db import ChatBranch


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
