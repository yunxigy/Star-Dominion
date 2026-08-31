"""Persistent storage for reviewable manuscript revision proposals."""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

PROPOSAL_STATUSES = {"proposed", "applied", "rejected", "stale"}
PROPOSAL_KINDS = {
    "selection_rewrite",
    "review_fix",
    "full_chapter_revision",
}


class RevisionStoreError(RuntimeError):
    pass


class RevisionStore:
    """Store proposals under the novel runtime directory, never under ``src``."""

    def __init__(self, project_root: Path, novel_id: str):
        self.project_root = Path(project_root).resolve()
        self.novel_id = str(novel_id)
        self.root = (
            self.project_root
            / "data"
            / "novels"
            / self.novel_id
            / "data"
            / "revisions"
        )

    def create_id(self) -> str:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        return f"rev_{stamp}_{uuid4().hex[:10]}"

    def save(self, proposal: dict[str, Any]) -> Path:
        payload = dict(proposal)
        proposal_id = self._proposal_id(payload.get("proposal_id"))
        chapter_id = self._chapter_id(payload.get("chapter_id"))
        kind = str(payload.get("kind") or "")
        status = str(payload.get("status") or "")
        if kind not in PROPOSAL_KINDS:
            raise RevisionStoreError(f"Invalid proposal kind: {kind}")
        if status not in PROPOSAL_STATUSES:
            raise RevisionStoreError(f"Invalid proposal status: {status}")
        payload["proposal_id"] = proposal_id
        payload["chapter_id"] = chapter_id
        target = self.path_for(proposal_id, chapter_id=chapter_id)
        self._atomic_json_write(target, payload)
        return target

    def load(self, proposal_id: str) -> dict[str, Any] | None:
        clean_id = self._proposal_id(proposal_id)
        if not self.root.is_dir():
            return None
        matches = list(self.root.glob(f"ch_*/{clean_id}.json"))
        if len(matches) != 1:
            return None
        try:
            payload = json.loads(matches[0].read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def list(
        self,
        *,
        chapter_id: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        if status is not None and status not in PROPOSAL_STATUSES:
            raise RevisionStoreError(f"Invalid proposal status: {status}")
        if chapter_id:
            roots = [self.root / self._chapter_id(chapter_id)]
        else:
            roots = sorted(self.root.glob("ch_*")) if self.root.is_dir() else []
        proposals: list[dict[str, Any]] = []
        for root in roots:
            if not root.is_dir():
                continue
            for path in sorted(root.glob("rev_*.json")):
                try:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if not isinstance(payload, dict):
                    continue
                if status is not None and payload.get("status") != status:
                    continue
                proposals.append(payload)
        return sorted(
            proposals,
            key=lambda item: str(item.get("created_at") or ""),
            reverse=True,
        )

    def update_status(
        self,
        proposal_id: str,
        status: str,
        *,
        expected: set[str] | None = None,
        updates: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if status not in PROPOSAL_STATUSES:
            raise RevisionStoreError(f"Invalid proposal status: {status}")
        proposal = self.load(proposal_id)
        if proposal is None:
            raise RevisionStoreError("Revision proposal not found")
        current = str(proposal.get("status") or "")
        if expected is not None and current not in expected:
            raise RevisionStoreError(
                f"Revision proposal status is {current}, expected one of {sorted(expected)}"
            )
        proposal["status"] = status
        if updates:
            proposal.update(updates)
        self.save(proposal)
        return proposal

    def path_for(self, proposal_id: str, *, chapter_id: str) -> Path:
        return self.root / self._chapter_id(chapter_id) / f"{self._proposal_id(proposal_id)}.json"

    def backup_path(self, chapter_id: str, proposal_id: str) -> Path:
        return (
            self.root
            / "backups"
            / self._chapter_id(chapter_id)
            / f"{self._proposal_id(proposal_id)}.md"
        )

    def save_backup(self, chapter_id: str, proposal_id: str, content: str) -> Path:
        target = self.backup_path(chapter_id, proposal_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        self._atomic_text_write(target, content)
        return target

    @staticmethod
    def _proposal_id(value: Any) -> str:
        proposal_id = str(value or "").strip()
        if not re.fullmatch(r"rev_[A-Za-z0-9_-]{8,80}", proposal_id):
            raise RevisionStoreError("Invalid revision proposal ID")
        return proposal_id

    @staticmethod
    def _chapter_id(value: Any) -> str:
        chapter_id = str(value or "").strip()
        if not re.fullmatch(r"ch_\d+", chapter_id):
            raise RevisionStoreError("Invalid chapter ID")
        return chapter_id

    @staticmethod
    def _atomic_json_write(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        RevisionStore._atomic_text_write(
            path,
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        )

    @staticmethod
    def _atomic_text_write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
                temp_path = Path(handle.name)
            temp_path.replace(path)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)
