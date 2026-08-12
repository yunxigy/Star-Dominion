from pathlib import Path
import sqlite3

from research_reports.database import create_database


def test_research_reports_records_schema_version_and_is_idempotent(tmp_path: Path) -> None:
    database_path = tmp_path / "reports.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "CREATE TABLE ai_reports (id TEXT PRIMARY KEY, report_date TEXT NOT NULL)"
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
        assert version == 1
        assert {"events_json", "risks_json"}.issubset(columns)
    finally:
        second.dispose()
