"""Versioned full-graph chat backup and restore."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.character_db import CharacterDB
from ..models.chat_db import (
    ChatBranch,
    ChatCheckpoint,
    ChatMessage,
    ChatSession,
)


MAX_BACKUP_BYTES = 10 * 1024 * 1024
MAX_BACKUP_MESSAGES = 20_000


class ChatBackupInvalid(ValueError):
    """The supplied backup is unsafe or internally inconsistent."""


@dataclass(frozen=True)
class BackupImportResult:
    session_id: str
    branch_count: int
    message_count: int
    checkpoint_count: int


def _iso(value) -> str | None:
    return value.isoformat() if value else None


class ChatBackupService:
    def __init__(self, db: Session, *, root: Path):
        self.db = db
        self.root = Path(root)

    def _owned_session(self, session_id: str, owner_id: str) -> ChatSession:
        session = self.db.scalar(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == owner_id,
            )
        )
        if session is None:
            raise LookupError("chat session not found")
        return session

    def export_session(self, session_id: str, *, owner_id: str) -> dict:
        session = self._owned_session(session_id, owner_id)
        branches = list(
            self.db.scalars(
                select(ChatBranch)
                .where(ChatBranch.session_id == session.id)
                .order_by(ChatBranch.created_at, ChatBranch.id)
            )
        )
        messages = list(
            self.db.scalars(
                select(ChatMessage)
                .where(ChatMessage.session_id == session.id)
                .order_by(ChatMessage.sequence, ChatMessage.created_at, ChatMessage.id)
            )
        )
        checkpoints = list(
            self.db.scalars(
                select(ChatCheckpoint)
                .where(ChatCheckpoint.session_id == session.id)
                .order_by(ChatCheckpoint.created_at, ChatCheckpoint.id)
            )
        )
        return {
            "format": "shouanren-chat-backup",
            "version": 1,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "branch_count": len(branches),
            "message_count": len(messages),
            "checkpoint_count": len(checkpoints),
            "session": {
                "id": session.id,
                "character_id": session.character_id,
                "current_branch_id": session.current_branch_id,
                "head_message_id": session.head_message_id,
                "title": session.title,
                "version": session.version,
                "created_at": _iso(session.created_at),
            },
            "branches": [
                {
                    "id": branch.id,
                    "parent_branch_id": branch.parent_branch_id,
                    "fork_message_id": branch.fork_message_id,
                    "head_message_id": branch.head_message_id,
                    "name": branch.name,
                    "created_at": _iso(branch.created_at),
                }
                for branch in branches
            ],
            "messages": [
                {
                    "id": message.id,
                    "role": message.role,
                    "content": message.content,
                    "swipes": message.swipes,
                    "swipe_id": message.swipe_id,
                    "branch_id": message.branch_id,
                    "parent_message_id": message.parent_message_id,
                    "sequence": message.sequence,
                    "created_at": _iso(message.created_at),
                    "edited_at": _iso(message.edited_at),
                }
                for message in messages
            ],
            "checkpoints": [
                {
                    "id": checkpoint.id,
                    "branch_id": checkpoint.branch_id,
                    "message_id": checkpoint.message_id,
                    "name": checkpoint.name,
                    "created_at": _iso(checkpoint.created_at),
                }
                for checkpoint in checkpoints
            ],
        }

    @staticmethod
    def validate_payload(payload: dict) -> None:
        try:
            encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise ChatBackupInvalid("backup is not valid JSON data") from exc
        if len(encoded) > MAX_BACKUP_BYTES:
            raise ChatBackupInvalid("backup exceeds 10 MiB")
        if payload.get("format") != "shouanren-chat-backup":
            raise ChatBackupInvalid("unknown backup format")
        if payload.get("version") != 1:
            raise ChatBackupInvalid("unsupported backup version")

        session = payload.get("session")
        branches = payload.get("branches")
        messages = payload.get("messages")
        checkpoints = payload.get("checkpoints")
        if not isinstance(session, dict) or not all(
            isinstance(items, list)
            for items in (branches, messages, checkpoints)
        ):
            raise ChatBackupInvalid("backup graph sections are missing")
        if len(messages) > MAX_BACKUP_MESSAGES:
            raise ChatBackupInvalid("backup contains too many messages")

        branch_ids = {item.get("id") for item in branches}
        message_ids = {item.get("id") for item in messages}
        if None in branch_ids or len(branch_ids) != len(branches):
            raise ChatBackupInvalid("branch IDs must be unique")
        if None in message_ids or len(message_ids) != len(messages):
            raise ChatBackupInvalid("message IDs must be unique")
        for branch in branches:
            if branch.get("parent_branch_id") not in branch_ids | {None}:
                raise ChatBackupInvalid("branch parent is missing")
            if branch.get("fork_message_id") not in message_ids | {None}:
                raise ChatBackupInvalid("branch fork message is missing")
            if branch.get("head_message_id") not in message_ids | {None}:
                raise ChatBackupInvalid("branch head message is missing")
        parents = {}
        for message in messages:
            if message.get("branch_id") not in branch_ids:
                raise ChatBackupInvalid("message branch is missing")
            parent_id = message.get("parent_message_id")
            if parent_id not in message_ids | {None}:
                raise ChatBackupInvalid("message parent is missing")
            parents[message["id"]] = parent_id
        for message_id in message_ids:
            seen = set()
            current = message_id
            while current is not None:
                if current in seen:
                    raise ChatBackupInvalid("message parent pointers contain a cycle")
                seen.add(current)
                current = parents[current]
        for checkpoint in checkpoints:
            if checkpoint.get("branch_id") not in branch_ids:
                raise ChatBackupInvalid("checkpoint branch is missing")
            if checkpoint.get("message_id") not in message_ids | {None}:
                raise ChatBackupInvalid("checkpoint message is missing")
        if session.get("current_branch_id") not in branch_ids | {None}:
            raise ChatBackupInvalid("active branch is missing")
        if session.get("head_message_id") not in message_ids | {None}:
            raise ChatBackupInvalid("active head message is missing")

    def import_session(self, payload: dict, *, owner_id: str) -> BackupImportResult:
        self.validate_payload(payload)
        session_data = payload["session"]
        character_id = session_data.get("character_id")
        if self.db.get(CharacterDB, character_id) is None:
            raise ChatBackupInvalid("backup character does not exist")

        session_id = str(uuid.uuid4())
        branch_ids = {item["id"]: str(uuid.uuid4()) for item in payload["branches"]}
        message_ids = {item["id"]: str(uuid.uuid4()) for item in payload["messages"]}
        checkpoint_ids = {
            item["id"]: str(uuid.uuid4()) for item in payload["checkpoints"]
        }
        session = ChatSession(
            id=session_id,
            user_id=owner_id,
            character_id=character_id,
            title=session_data.get("title"),
            version=1,
        )
        self.db.add(session)
        self.db.flush()

        branch_objects = {}
        for item in payload["branches"]:
            branch = ChatBranch(
                id=branch_ids[item["id"]],
                session_id=session.id,
                parent_branch_id=(
                    branch_ids[item["parent_branch_id"]]
                    if item.get("parent_branch_id")
                    else None
                ),
                name=item.get("name") or "导入分支",
            )
            branch_objects[item["id"]] = branch
            self.db.add(branch)
        self.db.flush()

        for item in payload["messages"]:
            self.db.add(
                ChatMessage(
                    id=message_ids[item["id"]],
                    session_id=session.id,
                    role=item["role"],
                    content=item.get("content") or {"text": ""},
                    swipes=item.get("swipes"),
                    swipe_id=str(item.get("swipe_id", "0")),
                    branch_id=branch_ids[item["branch_id"]],
                    parent_message_id=(
                        message_ids[item["parent_message_id"]]
                        if item.get("parent_message_id")
                        else None
                    ),
                    sequence=int(item.get("sequence") or 0),
                )
            )
        self.db.flush()

        for item in payload["branches"]:
            branch = branch_objects[item["id"]]
            branch.fork_message_id = (
                message_ids[item["fork_message_id"]]
                if item.get("fork_message_id")
                else None
            )
            branch.head_message_id = (
                message_ids[item["head_message_id"]]
                if item.get("head_message_id")
                else None
            )
        for item in payload["checkpoints"]:
            self.db.add(
                ChatCheckpoint(
                    id=checkpoint_ids[item["id"]],
                    session_id=session.id,
                    branch_id=branch_ids[item["branch_id"]],
                    message_id=(
                        message_ids[item["message_id"]]
                        if item.get("message_id")
                        else None
                    ),
                    name=item.get("name") or "导入检查点",
                )
            )
        session.current_branch_id = (
            branch_ids[session_data["current_branch_id"]]
            if session_data.get("current_branch_id")
            else None
        )
        session.head_message_id = (
            message_ids[session_data["head_message_id"]]
            if session_data.get("head_message_id")
            else None
        )
        self.db.commit()
        return BackupImportResult(
            session_id=session.id,
            branch_count=len(branch_ids),
            message_count=len(message_ids),
            checkpoint_count=len(checkpoint_ids),
        )

    def snapshot_after_change(
        self,
        session_id: str,
        *,
        owner_id: str,
        version: int,
    ) -> Path:
        payload = self.export_session(session_id, owner_id=owner_id)
        self.root.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        safe_session_id = "".join(
            character for character in session_id if character.isalnum() or character in "-_"
        )
        destination = self.root / (
            f"{safe_session_id}-{timestamp}-{version}-snapshot.json"
        )
        temporary = self.root / f".{destination.name}.{uuid.uuid4().hex}.tmp"
        try:
            with temporary.open("w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()

        snapshots = sorted(
            self.root.glob(f"{safe_session_id}-*-snapshot.json"),
            key=lambda path: (path.stat().st_mtime_ns, path.name),
            reverse=True,
        )
        for expired in snapshots[20:]:
            expired.unlink()
        return destination
