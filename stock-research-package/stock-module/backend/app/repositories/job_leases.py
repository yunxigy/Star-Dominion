"""SQLite leases and persisted state for scheduled background jobs."""

from datetime import datetime, timedelta
from pathlib import Path
import sqlite3


class JobLeaseRepository:
    def __init__(self, database_path: str | Path) -> None:
        self._path = Path(database_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def acquire(
        self,
        job_name: str,
        holder: str,
        *,
        now: datetime,
        ttl: timedelta,
    ) -> bool:
        expires_at = (now + ttl).isoformat()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT holder, expires_at FROM job_leases WHERE job_name = ?",
                (job_name,),
            ).fetchone()
            if row is not None and datetime.fromisoformat(row["expires_at"]) > now:
                return row["holder"] == holder
            connection.execute(
                """
                INSERT INTO job_leases (job_name, holder, expires_at)
                VALUES (?, ?, ?)
                ON CONFLICT(job_name) DO UPDATE SET
                    holder = excluded.holder,
                    expires_at = excluded.expires_at
                """,
                (job_name, holder, expires_at),
            )
            return True

    def release(self, job_name: str, holder: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "DELETE FROM job_leases WHERE job_name = ? AND holder = ?",
                (job_name, holder),
            )

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_leases (
                    job_name TEXT PRIMARY KEY,
                    holder TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path)
        connection.row_factory = sqlite3.Row
        return connection
