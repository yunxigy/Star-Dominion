"""Filesystem-backed task snapshots and append-only activity events."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

import yaml

TASK_STATUSES = {
    "pending",
    "running",
    "awaiting_confirmation",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
}
TASK_PHASES = (
    "queued",
    "reading",
    "preparing",
    "model",
    "validating",
    "committing",
    "complete",
)
SENSITIVE_KEY_PARTS = ("api_key", "credential", "password", "secret", "access_token")
ARTIFACT_THRESHOLD = 8000


class TaskStoreError(RuntimeError):
    pass


class TaskStore:
    def __init__(self, project_root: Path, novel_id: str):
        self.project_root = Path(project_root).resolve()
        self.novel_id = str(novel_id)
        self.root = (
            self.project_root
            / "data"
            / "novels"
            / self.novel_id
            / "data"
            / "workflows"
            / "tasks"
        )
        self.index_path = self.root / "index.yaml"
        self._lock = RLock()

    def create(
        self,
        task_type: str,
        payload: dict[str, Any],
        *,
        chapter_id: str = "",
        input_summary: str = "",
        retryable: bool = True,
        retry_of: str = "",
        attempt: int = 1,
    ) -> dict[str, Any]:
        clean_type = self._task_type(task_type)
        task_id = self.create_id()
        now = self._now()
        stored_input = self._externalize(
            payload,
            task_id=task_id,
            category="inputs",
        )
        task = {
            "task_id": task_id,
            "novel_id": self.novel_id,
            "type": clean_type,
            "status": "pending",
            "phase": "queued",
            "chapter_id": str(chapter_id or ""),
            "input_summary": str(input_summary or "")[:500],
            "input": stored_input,
            "result": {},
            "error": None,
            "retryable": bool(retryable),
            "retry_of": str(retry_of or ""),
            "attempt": max(1, int(attempt)),
            "cancel_requested": False,
            "created_at": now,
            "started_at": None,
            "completed_at": None,
            "updated_at": now,
        }
        with self._lock:
            self._save_unlocked(task)
            self._write_index_unlocked()
            event_id = self._append_event_unlocked(
                task_id,
                "task_created",
                status="pending",
                phase="queued",
                details={"type": clean_type, "chapter_id": task["chapter_id"]},
            )
            task["last_event_id"] = event_id
            self._save_unlocked(task)
            self._write_index_unlocked()
        return task

    def create_id(self) -> str:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        return f"tsk_{stamp}_{uuid4().hex[:10]}"

    def load(self, task_id: str) -> dict[str, Any] | None:
        # Reads share the same process-local lock as atomic snapshot writes.
        # Without this, a Studio polling thread can observe the tiny Windows
        # replace window and misreport an existing task as "not found".
        with self._lock:
            path = self.snapshot_path(task_id)
            if not path.is_file():
                return None
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except (OSError, yaml.YAMLError):
                return None
            return data if isinstance(data, dict) else None

    def list(
        self,
        *,
        statuses: set[str] | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        clean_limit = min(500, max(1, int(limit)))
        if statuses is not None and not statuses.issubset(TASK_STATUSES):
            raise TaskStoreError("Invalid task status filter")
        tasks: list[dict[str, Any]] = []
        if self.root.is_dir():
            for path in self.root.glob("task_tsk_*.yaml"):
                record = self.load(path.stem.removeprefix("task_"))
                if record is None:
                    continue
                if statuses is not None and record.get("status") not in statuses:
                    continue
                tasks.append(record)
        return sorted(
            tasks,
            key=lambda item: str(item.get("created_at") or ""),
            reverse=True,
        )[:clean_limit]

    def transition(
        self,
        task_id: str,
        *,
        status: str | None = None,
        phase: str | None = None,
        updates: dict[str, Any] | None = None,
        event: str = "task_updated",
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if status is not None and status not in TASK_STATUSES:
            raise TaskStoreError(f"Invalid task status: {status}")
        if phase is not None and phase not in TASK_PHASES:
            raise TaskStoreError(f"Invalid task phase: {phase}")
        with self._lock:
            task = self.load(task_id)
            if task is None:
                raise TaskStoreError("Task not found")
            now = self._now()
            if status is not None:
                task["status"] = status
                if status == "running" and not task.get("started_at"):
                    task["started_at"] = now
                if status in {"completed", "failed", "cancelled", "interrupted"}:
                    task["completed_at"] = now
            if phase is not None:
                task["phase"] = phase
            if updates:
                safe_updates = dict(updates)
                if "result" in safe_updates:
                    safe_updates["result"] = self._externalize(
                        safe_updates["result"],
                        task_id=task_id,
                        category="results",
                    )
                task.update(safe_updates)
            task["updated_at"] = now
            # Publish the append-only event first. A reader can therefore never
            # observe a terminal snapshot before its completion event is durable.
            event_id = self._append_event_unlocked(
                task_id,
                event,
                status=str(task.get("status") or ""),
                phase=str(task.get("phase") or ""),
                details=details or {},
            )
            task["last_event_id"] = event_id
            self._save_unlocked(task)
            self._write_index_unlocked()
            return task

    def request_cancel(self, task_id: str) -> dict[str, Any]:
        task = self.load(task_id)
        if task is None:
            raise TaskStoreError("Task not found")
        status = str(task.get("status") or "")
        if status in {"pending", "awaiting_confirmation"}:
            return self.transition(
                task_id,
                status="cancelled",
                updates={"cancel_requested": True},
                event="task_cancelled",
            )
        if status == "running":
            return self.transition(
                task_id,
                updates={"cancel_requested": True},
                event="task_cancel_requested",
            )
        return task

    def clear_failed(self) -> dict[str, Any]:
        deleted: list[str] = []
        with self._lock:
            storage_root = self.root.resolve()
            while True:
                candidates = self.list(statuses={"failed"}, limit=500)
                if not candidates:
                    break
                for candidate in candidates:
                    task_id = self._task_id(str(candidate.get("task_id") or ""))
                    current = self.load(task_id)
                    if current is None or current.get("status") != "failed":
                        continue

                    snapshot_path = self.snapshot_path(task_id)
                    events_path = self.events_path(task_id)
                    artifact_dirs = [
                        (self.root / category / task_id).resolve()
                        for category in ("inputs", "results")
                    ]
                    if any(storage_root not in path.parents for path in artifact_dirs):
                        raise TaskStoreError("Task artifact path escapes task store")

                    snapshot_path.unlink(missing_ok=True)
                    events_path.unlink(missing_ok=True)
                    for artifact_dir in artifact_dirs:
                        if artifact_dir.is_dir():
                            shutil.rmtree(artifact_dir)
                    deleted.append(task_id)
            self._write_index_unlocked()
        return {"deleted_count": len(deleted), "task_ids": deleted}

    def recover_interrupted(self) -> list[dict[str, Any]]:
        recovered: list[dict[str, Any]] = []
        for task in self.list(statuses={"running"}, limit=500):
            recovered.append(
                self.transition(
                    str(task["task_id"]),
                    status="interrupted",
                    updates={
                        "error": {
                            "code": "PROCESS_INTERRUPTED",
                            "message": "Studio 在任务运行期间退出",
                            "recoverable": bool(task.get("retryable")),
                        }
                    },
                    event="task_interrupted",
                )
            )
        return recovered

    def events(self, task_id: str, *, limit: int = 200) -> list[dict[str, Any]]:
        path = self.events_path(task_id)
        if not path.is_file():
            return []
        events: list[dict[str, Any]] = []
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        for line in lines[-min(1000, max(1, int(limit))) :]:
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                events.append(payload)
        return events

    def materialize_input(self, task: dict[str, Any]) -> dict[str, Any]:
        value = self._materialize(task.get("input"))
        return value if isinstance(value, dict) else {}

    def materialize_result(self, task: dict[str, Any]) -> dict[str, Any]:
        value = self._materialize(task.get("result"))
        return value if isinstance(value, dict) else {}

    def snapshot_path(self, task_id: str) -> Path:
        return self.root / f"task_{self._task_id(task_id)}.yaml"

    def events_path(self, task_id: str) -> Path:
        return self.root / f"task_{self._task_id(task_id)}.jsonl"

    def _save_unlocked(self, task: dict[str, Any]) -> None:
        path = self.snapshot_path(str(task["task_id"]))
        self._atomic_text_write(
            path,
            yaml.safe_dump(task, allow_unicode=True, sort_keys=False),
        )

    def _write_index_unlocked(self) -> None:
        records = []
        if self.root.is_dir():
            for path in self.root.glob("task_tsk_*.yaml"):
                try:
                    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
                except (OSError, yaml.YAMLError):
                    continue
                if not isinstance(data, dict):
                    continue
                records.append(
                    {
                        key: data.get(key)
                        for key in (
                            "task_id",
                            "type",
                            "status",
                            "phase",
                            "chapter_id",
                            "created_at",
                            "updated_at",
                        )
                    }
                )
        payload = {
            "version": 1,
            "novel_id": self.novel_id,
            "updated_at": self._now(),
            "tasks": sorted(
                records,
                key=lambda item: str(item.get("created_at") or ""),
                reverse=True,
            ),
        }
        self._atomic_text_write(
            self.index_path,
            yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        )

    def _append_event_unlocked(
        self,
        task_id: str,
        event: str,
        *,
        status: str,
        phase: str,
        details: dict[str, Any],
    ) -> str:
        path = self.events_path(task_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "event_id": f"evt_{uuid4().hex}",
            "task_id": task_id,
            "event": event,
            "status": status,
            "phase": phase,
            "created_at": self._now(),
            "details": self._sanitize(details),
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        return str(payload["event_id"])

    def _externalize(self, value: Any, *, task_id: str, category: str, path: str = "root") -> Any:
        if isinstance(value, dict):
            result: dict[str, Any] = {}
            for key, item in value.items():
                clean_key = str(key)
                if any(part in clean_key.lower() for part in SENSITIVE_KEY_PARTS):
                    result[clean_key] = "[redacted]"
                else:
                    result[clean_key] = self._externalize(
                        item,
                        task_id=task_id,
                        category=category,
                        path=f"{path}.{clean_key}",
                    )
            return result
        if isinstance(value, (list, tuple)):
            return [
                self._externalize(
                    item,
                    task_id=task_id,
                    category=category,
                    path=f"{path}.{index}",
                )
                for index, item in enumerate(value)
            ]
        if isinstance(value, str) and len(value) > ARTIFACT_THRESHOLD:
            digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
            safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", path).strip("._")[-80:] or "text"
            target = self.root / category / task_id / f"{safe_name}_{digest[:10]}.txt"
            self._atomic_text_write(target, value)
            return {
                "$artifact": target.relative_to(self.root).as_posix(),
                "sha256": digest,
                "characters": len(value),
            }
        return self._sanitize(value)

    def _materialize(self, value: Any) -> Any:
        if isinstance(value, dict):
            artifact = value.get("$artifact")
            if isinstance(artifact, str):
                path = (self.root / artifact).resolve()
                if self.root.resolve() not in path.parents or not path.is_file():
                    raise TaskStoreError("Task artifact is missing")
                raw_content = path.read_bytes()
                digest = hashlib.sha256(raw_content).hexdigest()
                if digest != value.get("sha256"):
                    raise TaskStoreError("Task artifact checksum mismatch")
                try:
                    return raw_content.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise TaskStoreError("Task artifact is not valid UTF-8") from exc
            return {str(key): self._materialize(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._materialize(item) for item in value]
        return value

    @classmethod
    def _sanitize(cls, value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, Path):
            return str(value)
        if isinstance(value, dict):
            return {str(key): cls._sanitize(item) for key, item in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [cls._sanitize(item) for item in value]
        return str(value)

    @staticmethod
    def _atomic_text_write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                handle.write(content.encode("utf-8"))
                handle.flush()
                os.fsync(handle.fileno())
                temp_path = Path(handle.name)
            temp_path.replace(path)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

    @staticmethod
    def _task_type(value: str) -> str:
        task_type = str(value or "").strip()
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,63}", task_type):
            raise TaskStoreError("Invalid task type")
        return task_type

    @staticmethod
    def _task_id(value: str) -> str:
        task_id = str(value or "").strip()
        if not re.fullmatch(r"tsk_[A-Za-z0-9_-]{8,80}", task_id):
            raise TaskStoreError("Invalid task ID")
        return task_id

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
