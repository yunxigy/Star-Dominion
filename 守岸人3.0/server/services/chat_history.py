"""Branch-aware chat history domain operations."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..models.chat_db import (
    ChatBranch,
    ChatCheckpoint,
    ChatMessage,
    ChatSession,
)


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

    def edit_message(
        self,
        message_id: str,
        text: str,
        *,
        expected_version: int,
    ) -> ChatMessage:
        target = self.owned_message(message_id)
        session = self.require_version(target.session_id, expected_version)
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("message content cannot be empty")

        branch = ChatBranch(
            session_id=session.id,
            parent_branch_id=session.current_branch_id,
            fork_message_id=target.parent_message_id,
            name="编辑分支",
        )
        self.db.add(branch)
        self.db.flush()
        edited = ChatMessage(
            session_id=session.id,
            role=target.role,
            content={**(target.content or {}), "text": clean_text},
            swipes=[clean_text] if target.role == "assistant" else None,
            swipe_id="0",
            branch_id=branch.id,
            parent_message_id=target.parent_message_id,
            sequence=target.sequence,
            edited_at=datetime.now(timezone.utc),
        )
        self.db.add(edited)
        self.db.flush()
        branch.head_message_id = edited.id
        session.current_branch_id = branch.id
        session.head_message_id = edited.id
        session.version += 1
        self.db.commit()
        self.db.refresh(edited)
        return edited

    def delete_from(
        self,
        message_id: str,
        *,
        expected_version: int,
    ) -> ChatBranch:
        target = self.owned_message(message_id)
        session = self.require_version(target.session_id, expected_version)
        branch = ChatBranch(
            session_id=session.id,
            parent_branch_id=session.current_branch_id,
            fork_message_id=target.parent_message_id,
            head_message_id=target.parent_message_id,
            name="删除分支",
        )
        self.db.add(branch)
        self.db.flush()
        session.current_branch_id = branch.id
        session.head_message_id = target.parent_message_id
        session.version += 1
        self.db.commit()
        self.db.refresh(branch)
        return branch

    def list_branches(self, session_id: str) -> list[ChatBranch]:
        self.owned_session(session_id)
        return list(
            self.db.scalars(
                select(ChatBranch)
                .where(ChatBranch.session_id == session_id)
                .order_by(ChatBranch.created_at, ChatBranch.id)
            )
        )

    def activate_branch(
        self,
        session_id: str,
        branch_id: str,
        *,
        expected_version: int,
    ) -> ChatSession:
        session = self.require_version(session_id, expected_version)
        branch = self.db.scalar(
            select(ChatBranch).where(
                ChatBranch.id == branch_id,
                ChatBranch.session_id == session.id,
            )
        )
        if branch is None:
            raise ChatResourceNotFound("chat branch not found")
        session.current_branch_id = branch.id
        session.head_message_id = branch.head_message_id
        session.version += 1
        self.db.commit()
        self.db.refresh(session)
        return session

    def create_checkpoint(
        self,
        session_id: str,
        name: str,
        message_id: str | None,
        *,
        expected_version: int,
    ) -> ChatCheckpoint:
        session = self.require_version(session_id, expected_version)
        checkpoint_name = name.strip()
        if not checkpoint_name or len(checkpoint_name) > 120:
            raise ValueError("checkpoint name must contain 1 to 120 characters")
        selected_message_id = message_id or session.head_message_id
        if selected_message_id is not None:
            message = self.owned_message(selected_message_id)
            if message.session_id != session.id:
                raise ChatResourceNotFound("checkpoint message not found")
        checkpoint = ChatCheckpoint(
            session_id=session.id,
            branch_id=session.current_branch_id,
            message_id=selected_message_id,
            name=checkpoint_name,
        )
        self.db.add(checkpoint)
        session.version += 1
        self.db.commit()
        self.db.refresh(checkpoint)
        return checkpoint

    def list_checkpoints(self, session_id: str) -> list[ChatCheckpoint]:
        self.owned_session(session_id)
        return list(
            self.db.scalars(
                select(ChatCheckpoint)
                .where(ChatCheckpoint.session_id == session_id)
                .order_by(ChatCheckpoint.created_at, ChatCheckpoint.id)
            )
        )

    def _owned_checkpoint(self, checkpoint_id: str) -> ChatCheckpoint:
        checkpoint = self.db.scalar(
            select(ChatCheckpoint)
            .join(ChatSession, ChatSession.id == ChatCheckpoint.session_id)
            .where(
                ChatCheckpoint.id == checkpoint_id,
                ChatSession.user_id == self.owner_id,
            )
        )
        if checkpoint is None:
            raise ChatResourceNotFound("chat checkpoint not found")
        return checkpoint

    def restore_checkpoint(
        self,
        checkpoint_id: str,
        *,
        expected_version: int,
    ) -> ChatSession:
        checkpoint = self._owned_checkpoint(checkpoint_id)
        session = self.require_version(
            checkpoint.session_id,
            expected_version,
        )
        branch = ChatBranch(
            session_id=session.id,
            parent_branch_id=checkpoint.branch_id,
            fork_message_id=checkpoint.message_id,
            head_message_id=checkpoint.message_id,
            name=f"恢复：{checkpoint.name}"[:120],
        )
        self.db.add(branch)
        self.db.flush()
        session.current_branch_id = branch.id
        session.head_message_id = branch.head_message_id
        session.version += 1
        self.db.commit()
        self.db.refresh(session)
        return session

    def delete_checkpoint(
        self,
        checkpoint_id: str,
        *,
        expected_version: int,
    ) -> ChatSession:
        checkpoint = self._owned_checkpoint(checkpoint_id)
        session = self.require_version(
            checkpoint.session_id,
            expected_version,
        )
        self.db.delete(checkpoint)
        session.version += 1
        self.db.commit()
        self.db.refresh(session)
        return session
