from pathlib import Path
import sqlite3
from datetime import datetime, timezone
import pytest
from sqlalchemy.exc import IntegrityError

from research_reports.database import create_database
from research_reports.models import XEventReport, XPost


def test_research_reports_records_schema_version_and_is_idempotent(tmp_path: Path) -> None:
    database_path = tmp_path / "reports.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "CREATE TABLE ai_reports (id TEXT PRIMARY KEY, report_date TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO ai_reports (id, report_date) VALUES ('legacy-report', '2026-09-25')"
        )
        connection.commit()

    database = create_database(database_path)
    database.dispose()
    second = create_database(database_path)
    try:
        with second.engine.connect() as connection:
            version = connection.exec_driver_sql(
                "SELECT version FROM schema_metadata WHERE id = 1"
            ).scalar_one()
            columns = {
                row[1]
                for row in connection.exec_driver_sql("PRAGMA table_info(ai_reports)")
            }
            tables = {
                row[0]
                for row in connection.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            legacy_date = connection.exec_driver_sql(
                "SELECT report_date FROM ai_reports WHERE id = 'legacy-report'"
            ).scalar_one()
        assert version == 2
        assert {"events_json", "risks_json"}.issubset(columns)
        assert {"x_posts", "x_event_reports"}.issubset(tables)
        assert legacy_date == "2026-09-25"
    finally:
        second.dispose()


def test_x_event_tables_enforce_external_id_and_idempotency_uniqueness(tmp_path: Path) -> None:
    database = create_database(tmp_path / "reports.db")
    post_values = {
        "provider": "fxtwitter",
        "external_id": "post-1",
        "author": "OpenAI",
        "username": "OpenAI",
        "text": "A substantive AI update.",
        "canonical_url": "https://x.com/OpenAI/status/post-1",
        "published_at": datetime.now(timezone.utc),
        "importance": 80,
    }
    report_values = {
        "idempotency_key": "x-batch-1",
        "status": "published",
        "model_provider": "google",
        "model_name": "gemini-2.5-flash",
        "title": "AI 圈大事",
        "summary_markdown": "本轮摘要。",
        "events_json": [],
        "risks_json": [],
        "post_ids_json": [{"provider": "fxtwitter", "external_id": "post-1"}],
    }
    try:
        with database.sessions() as session:
            session.add(XPost(**post_values))
            session.add(XEventReport(**report_values))
            session.commit()
            session.add(XPost(**post_values))
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()
            session.add(XEventReport(**report_values))
            with pytest.raises(IntegrityError):
                session.commit()
    finally:
        database.dispose()
