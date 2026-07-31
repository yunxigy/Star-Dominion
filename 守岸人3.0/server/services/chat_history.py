"""Branch-aware chat history domain operations."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..models.chat_db import ChatBranch, ChatMessage, ChatSession


class ChatResourceNotFound(LookupError):
    """A chat resource is absent or not owned by the active user."""


class ChatHistoryCorrupt(RuntimeError):
    """The stored parent-pointer graph cannot be traversed safely."""


class ChatVersionConflict(RuntimeError):
    """The client attempted to mutate an out-of-date chat session."""


class ChatHistoryService:
    def __init__(self, db: Session, *, owner_id: str):
        self.db = db
        self.owner_id = owner_id

    def owned_session(self, session_id: str) -> ChatSession:
        session = self.db.scalar(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == self.owner_id,
            )
        )
        if session is None:
            raise ChatResourceNotFound("chat session not found")
        return session

    def owned_message(self, message_id: str) -> ChatMessage:
        message = self.db.scalar(
            select(ChatMessage)
            .join(ChatSession, ChatSession.id == ChatMessage.session_id)
            .where(
                ChatMessage.id == message_id,
                ChatSession.user_id == self.owner_id,
            )
        )
        if message is None:
            raise ChatResourceNotFound("chat message not found")
        return message

    def require_version(
        self,
        session_id: str,
        expected_version: int,
    ) -> ChatSession:
        session = self.owned_session(session_id)
        if session.version != expected_version:
            raise ChatVersionConflict(
                f"expected chat version {expected_version}, got {session.version}"
            )
        return session

    def active_path(
        self,
        session_id: str,
        *,
        head_id: str | None = None,
    ) -> list[ChatMessage]:
        session = self.owned_session(session_id)
        current_id = session.head_message_id if head_id is None else head_id
        if current_id is None:
            return []

        messages = {
            message.id: message
            for message in self.db.scalars(
                select(ChatMessage).where(ChatMessage.session_id == session.id)
            )
        }
        path: list[ChatMessage] = []
        seen: set[str] = set()
        while current_id is not None:
            if current_id in seen:
                raise ChatHistoryCorrupt("chat parent pointers contain a cycle")
            seen.add(current_id)
            message = messages.get(current_id)
            if message is None:
                raise ChatHistoryCorrupt("chat parent pointer references missing message")
            path.append(message)
            current_id = message.parent_message_id
        path.reverse()
        return path

    def context_before(self, message_id: str) -> list[ChatMessage]:
        message = self.owned_message(message_id)
        if message.parent_message_id is None:
            return []
        return self.active_path(
            message.session_id,
            head_id=message.parent_message_id,
        )

    @staticmethod
    def selected_text(message: ChatMessage) -> str:
        content = message.content or {}
        fallback = str(content.get("text", ""))
        if message.role != "assistant":
            return fallback
        try:
            swipe_index = int(message.swipe_id or 0)
        except (TypeError, ValueError):
            return fallback
        swipes = message.swipes or []
        if 0 <= swipe_index < len(swipes):
            return str(swipes[swipe_index])
        return fallback

    def prompt_messages_before(
        self,
        message_id: str,
    ) -> list[dict[str, str]]:
        return [
            {
                "role": message.role,
                "content": self.selected_text(message),
            }
            for message in self.context_before(message_id)
        ]

    def append_message(
        self,
        session_id: str,
        role: str,
        text: str,
    ) -> ChatMessage:
        session = self.owned_session(session_id)
        if not session.current_branch_id:
            raise ChatHistoryCorrupt("chat session has no active branch")
        branch = self.db.get(ChatBranch, session.current_branch_id)
        if branch is None or branch.session_id != session.id:
            raise ChatHistoryCorrupt("active branch is missing")

        parent = (
            self.db.get(ChatMessage, session.head_message_id)
            if session.head_message_id
            else None
        )
        message = ChatMessage(
            session_id=session.id,
            role=role,
            content={"text": text},
            swipes=[text] if role == "assistant" else None,
            swipe_id="0",
            branch_id=branch.id,
            parent_message_id=parent.id if parent else None,
            sequence=(parent.sequence + 1) if parent else 1,
        )
        self.db.add(message)
        self.db.flush()
        branch.head_message_id = message.id
        session.head_message_id = message.id
        session.version = (session.version or 0) + 1
        self.db.commit()
        self.db.refresh(message)
        return message

    def append_swipe(self, message_id: str, text: str) -> ChatMessage:
        message = self.owned_message(message_id)
        if message.role != "assistant":
            raise ValueError("only assistant messages support swipes")
        swipes = list(message.swipes or [self.selected_text(message)])
        swipes.append(text)
        message.swipes = swipes
        message.swipe_id = str(len(swipes) - 1)
        message.content = {**(message.content or {}), "text": text}
        flag_modified(message, "swipes")
        flag_modified(message, "content")
        self.db.commit()
        self.db.refresh(message)
        return message

    def select_swipe(self, message_id: str, swipe_id: int) -> ChatMessage:
        message = self.owned_message(message_id)
        swipes = list(message.swipes or [])
        if not 0 <= swipe_id < len(swipes):
            raise ValueError("swipe index out of range")
        message.swipe_id = str(swipe_id)
        message.content = {
            **(message.content or {}),
            "text": str(swipes[swipe_id]),
        }
        flag_modified(message, "content")
        self.db.commit()
        self.db.refresh(message)
        return message
