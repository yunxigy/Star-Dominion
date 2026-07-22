"""SQLite persistence for candidate refresh task state."""

from datetime import UTC, datetime
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from app.integrations.candidate_workers import WorkerResult
from app.services.candidate_refresh import CandidateSourceStatus


class RefreshTask(BaseModel):
    task_id: str
    status: Literal["queued", "running", "succeeded", "partial", "failed"]
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    worker_results: list[WorkerResult] = Field(default_factory=list)
    source_statuses: list[CandidateSourceStatus] = Field(default_factory=list)
    message: str | None = None


class RefreshTaskRepository:
    def __init__(self, database_path: str | Path) -> None:
        self._path = Path(database_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def create(self) -> RefreshTask:
        task = RefreshTask(task_id=str(uuid4()), status="queued", created_at=datetime.now(UTC))
        self.save(task)
        return task

    def save(self, task: RefreshTask) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO candidate_refresh_tasks (task_id, status, payload, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    status = excluded.status,
                    payload = excluded.payload,
                    updated_at = excluded.updated_at
                """,
                (task.task_id, task.status, task.model_dump_json(), datetime.now(UTC).isoformat()),
            )

    def get(self, task_id: str) -> RefreshTask | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM candidate_refresh_tasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
        return RefreshTask.model_validate_json(row[0]) if row else None

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS candidate_refresh_tasks (
                    task_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path)
