from __future__ import annotations

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session


def _create_legacy_chat_database(path):
    engine = create_engine(f"sqlite:///{path}")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE chat_sessions (
                    id VARCHAR PRIMARY KEY,
                    user_id VARCHAR NOT NULL,
                    character_id VARCHAR NOT NULL,
                    created_at DATETIME,
                    updated_at DATETIME
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE chat_messages (
                    id VARCHAR PRIMARY KEY,
                    session_id VARCHAR NOT NULL,
                    role VARCHAR(20) NOT NULL,
                    content JSON NOT NULL,
                    swipes JSON,
                    swipe_id VARCHAR,
                    created_at DATETIME
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO chat_sessions
                    (id, user_id, character_id, created_at)
                VALUES
                    ('session-1', 'user-1', 'character-1', '2026-01-01 08:00:00')
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO chat_messages
                    (id, session_id, role, content, swipes, swipe_id, created_at)
                VALUES
                    ('message-1', 'session-1', 'user', '{"text":"你好"}', NULL, '0', '2026-01-01 08:00:01'),
                    ('message-2', 'session-1', 'assistant', '{"text":"你好，漂泊者"}', '["你好，漂泊者"]', '0', '2026-01-01 08:00:02'),
                    ('message-3', 'session-1', 'user', '{"text":"继续"}', NULL, '0', '2026-01-01 08:00:03')
                """
            )
        )
    return engine


def test_chat_graph_migration_is_idempotent(tmp_path):
    from server.database import migrate_chat_graph
    from server.models.chat_db import ChatBranch, ChatMessage, ChatSession

    engine = _create_legacy_chat_database(tmp_path / "legacy.db")
    migrate_chat_graph(engine)
    migrate_chat_graph(engine)

    with Session(engine) as session:
        chat_session = session.get(ChatSession, "session-1")
        messages = session.query(ChatMessage).order_by(ChatMessage.sequence).all()
        root_branch = session.get(ChatBranch, chat_session.current_branch_id)

        assert chat_session.current_branch_id is not None
        assert chat_session.head_message_id == messages[-1].id
        assert chat_session.version == 1
        assert root_branch.head_message_id == messages[-1].id
        assert [message.parent_message_id for message in messages] == [
            None,
            messages[0].id,
            messages[1].id,
        ]
        assert [message.sequence for message in messages] == [1, 2, 3]
        assert len({message.branch_id for message in messages}) == 1
        assert session.query(ChatBranch).count() == 1

    engine.dispose()
