from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from server.database import Base
from server.models.character_db import CharacterDB
from server.models.chat_db import ChatBranch, ChatMessage, ChatSession
from server.models.user import User


@pytest.fixture
def db_session(tmp_path) -> Iterator[Session]:
    database_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{database_path}")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def seeded_chat(db_session):
    owner = User(
        id="owner-1",
        site_user_id="site-owner-1",
        username="owner",
        email="owner@example.com",
        password_hash="!site-auth-only!",
    )
    character = CharacterDB(
        id="character-1",
        user_id=owner.id,
        creator_id=owner.id,
        name="守岸人",
    )
    chat_session = ChatSession(
        id="session-1",
        user_id=owner.id,
        character_id=character.id,
        current_branch_id="branch-1",
        version=1,
    )
    branch = ChatBranch(
        id="branch-1",
        session_id=chat_session.id,
        name="主分支",
    )
    user_message = ChatMessage(
        id="message-1",
        session_id=chat_session.id,
        role="user",
        content={"text": "你好"},
        branch_id=branch.id,
        parent_message_id=None,
        sequence=1,
    )
    assistant_message = ChatMessage(
        id="message-2",
        session_id=chat_session.id,
        role="assistant",
        content={"text": "你好，漂泊者"},
        swipes=["你好，漂泊者"],
        swipe_id="0",
        branch_id=branch.id,
        parent_message_id=user_message.id,
        sequence=2,
    )
    db_session.add_all(
        [
            owner,
            character,
            chat_session,
            branch,
            user_message,
            assistant_message,
        ]
    )
    db_session.commit()
    chat_session.head_message_id = assistant_message.id
    branch.head_message_id = assistant_message.id
    db_session.commit()

    return type(
        "SeededChat",
        (),
        {
            "user_id": owner.id,
            "owner": owner,
            "character": character,
            "session": chat_session,
            "root_branch": branch,
            "user_message": user_message,
            "assistant_message": assistant_message,
        },
    )()
