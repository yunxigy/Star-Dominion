"""SQLite persistence for analysis task state and completed report cache."""

from datetime import UTC, datetime
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from app.domain.analysis_tasks import AnalysisCreate, AnalysisTask
from app.domain.model_profiles import StoredModelProfile


class AnalysisTaskRepository:
    def __init__(self, database_path: str | Path) -> None:
        self._path = Path(database_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def create(
        self,
        request: AnalysisCreate,
        *,
        owner_id: str,
        profile: StoredModelProfile,
    ) -> AnalysisTask:
        now = datetime.now(UTC)
        task = AnalysisTask(
            task_id=str(uuid4()),
            owner_id=owner_id,
            symbol=request.symbol,
            profile_id=profile.id,
            profile_name=profile.name,
            profile_scope=profile.scope,
            model=request.model,
            report_type=request.report_type,
            force_refresh=request.force_refresh,
            state="queued",
            progress_message="等待分析",
            created_at=now,
            updated_at=now,
        )
        self.save(task)
        return task

    def save(self, task: AnalysisTask) -> None:
        task.updated_at = datetime.now(UTC)
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO analysis_tasks (task_id, owner_id, state, payload, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    owner_id = excluded.owner_id,
                    state = excluded.state,
                    payload = excluded.payload,
                    updated_at = excluded.updated_at
                """,
                (
                    task.task_id,
                    task.owner_id,
                    task.state,
                    task.model_dump_json(),
                    task.updated_at.isoformat(),
                ),
            )

    def get(self, task_id: str, *, owner_id: str | None = None) -> AnalysisTask | None:
        query = "SELECT payload FROM analysis_tasks WHERE task_id = ?"
        parameters: tuple[str, ...] = (task_id,)
        if owner_id is not None:
            query += " AND owner_id = ?"
            parameters = (task_id, owner_id)
        with self._connect() as connection:
            row = connection.execute(query, parameters).fetchone()
        return AnalysisTask.model_validate_json(row[0]) if row else None

    def save_cache(self, key: str, report: dict, *, upstream_query_id: str | None) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO analysis_cache (cache_key, report_json, upstream_query_id, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(cache_key) DO UPDATE SET
                    report_json = excluded.report_json,
                    upstream_query_id = excluded.upstream_query_id,
                    created_at = excluded.created_at
                """,
                (
                    key,
                    json.dumps(report, ensure_ascii=False, separators=(",", ":")),
                    upstream_query_id,
                    datetime.now(UTC).isoformat(),
                ),
            )

    def get_cache(self, key: str) -> tuple[dict, str | None] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT report_json, upstream_query_id FROM analysis_cache WHERE cache_key = ?",
                (key,),
            ).fetchone()
        if row is None:
            return None
        return json.loads(row[0]), row[1]

    def recover_incomplete(self) -> int:
        recovered = 0
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM analysis_tasks WHERE state IN ('queued','collecting','analyzing','rendering')"
            ).fetchall()
        for row in rows:
            task = AnalysisTask.model_validate_json(row[0])
            task.state = "failed"
            task.progress_message = "分析服务重启，任务已终止"
            task.error_code = "ANALYSIS_INTERRUPTED"
            task.error_message = "分析服务重启，请重新发起分析"
            task.finished_at = datetime.now(UTC)
            self.save(task)
            recovered += 1
        return recovered

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS analysis_tasks (
                    task_id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    state TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS analysis_cache (
                    cache_key TEXT PRIMARY KEY,
                    report_json TEXT NOT NULL,
                    upstream_query_id TEXT,
                    created_at TEXT NOT NULL
                );
                """
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path)

