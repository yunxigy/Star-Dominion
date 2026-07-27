"""SQLite history for real-source Mom Index snapshots."""

from pathlib import Path
import sqlite3

from app.domain.mom_index import MomIndexSnapshot


class MomIndexRepository:
    def __init__(self, database_path: str | Path) -> None:
        self._path = Path(database_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def save(self, snapshot: MomIndexSnapshot) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO mom_index_snapshots (snapshot_date, payload, generated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(snapshot_date) DO UPDATE SET
                    payload = excluded.payload,
                    generated_at = excluded.generated_at
                """,
                (
                    snapshot.snapshot_date.isoformat(),
                    snapshot.model_dump_json(),
                    snapshot.generated_at.isoformat(),
                ),
            )

    def current(self) -> MomIndexSnapshot | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT payload FROM mom_index_snapshots
                ORDER BY snapshot_date DESC, generated_at DESC
                LIMIT 1
                """
            ).fetchone()
        return MomIndexSnapshot.model_validate_json(row[0]) if row else None

    def history(self, limit: int = 30) -> list[MomIndexSnapshot]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT payload FROM mom_index_snapshots
                ORDER BY snapshot_date DESC, generated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [MomIndexSnapshot.model_validate_json(row[0]) for row in rows]

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS mom_index_snapshots (
                    snapshot_date TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    generated_at TEXT NOT NULL
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path)
