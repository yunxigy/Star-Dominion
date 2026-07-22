"""SQLite history for normalized CatDesk morning reports."""

from datetime import UTC, date, datetime
from pathlib import Path
import sqlite3

from app.domain.morning_reports import MorningReport, MorningReportHistoryItem


class MorningReportRepository:
    def __init__(self, database_path: str | Path) -> None:
        self._path = Path(database_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def save(self, report: MorningReport) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO morning_reports (report_date, payload, generated_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(report_date) DO UPDATE SET
                    payload = excluded.payload,
                    generated_at = excluded.generated_at,
                    updated_at = excluded.updated_at
                """,
                (
                    report.report_date.isoformat(),
                    report.model_dump_json(),
                    report.generated_at.isoformat(),
                    datetime.now(UTC).isoformat(),
                ),
            )

    def latest(self) -> MorningReport | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM morning_reports ORDER BY report_date DESC LIMIT 1"
            ).fetchone()
        return MorningReport.model_validate_json(row[0]) if row else None

    def get(self, report_date: date) -> MorningReport | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM morning_reports WHERE report_date = ?",
                (report_date.isoformat(),),
            ).fetchone()
        return MorningReport.model_validate_json(row[0]) if row else None

    def list_history(self, limit: int = 30) -> list[MorningReportHistoryItem]:
        bounded = min(max(limit, 1), 100)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT report_date, generated_at
                FROM morning_reports
                ORDER BY report_date DESC
                LIMIT ?
                """,
                (bounded,),
            ).fetchall()
        return [
            MorningReportHistoryItem(
                report_date=date.fromisoformat(row[0]),
                generated_at=datetime.fromisoformat(row[1]),
            )
            for row in rows
        ]

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS morning_reports (
                    report_date TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    generated_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path)
