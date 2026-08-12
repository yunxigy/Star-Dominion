from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from research_reports.config import Settings
from research_reports.database import create_database
from research_reports.models import WeeklyIssue


def test_settings_resolve_data_dir_and_optional_token(tmp_path: Path) -> None:
    settings = Settings.from_env(
        {
            "RESEARCH_REPORTS_DATA_DIR": str(tmp_path),
            "RESEARCH_REPORTS_TIMEZONE": "Asia/Shanghai",
            "RESEARCH_REPORTS_SITE_AUTH_URL": "http://127.0.0.1:8000",
            "SITE_AUTH_INTERNAL_KEY": "k" * 32,
        }
    )

    assert settings.database_path == tmp_path.resolve() / "reports.db"
    assert settings.github_token is None
    assert settings.timezone.key == "Asia/Shanghai"


def test_settings_reject_short_internal_key(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="SITE_AUTH_INTERNAL_KEY"):
        Settings.from_env(
            {
                "RESEARCH_REPORTS_DATA_DIR": str(tmp_path),
                "RESEARCH_REPORTS_TIMEZONE": "Asia/Shanghai",
                "RESEARCH_REPORTS_SITE_AUTH_URL": "http://127.0.0.1:8000",
                "SITE_AUTH_INTERNAL_KEY": "short",
            }
        )


def test_settings_reuses_stock_platform_profile_when_report_key_is_missing(tmp_path: Path) -> None:
    settings = Settings.from_env(
        {
            "RESEARCH_REPORTS_DATA_DIR": str(tmp_path),
            "RESEARCH_REPORTS_TIMEZONE": "Asia/Shanghai",
            "RESEARCH_REPORTS_SITE_AUTH_URL": "http://127.0.0.1:8000",
            "SITE_AUTH_INTERNAL_KEY": "k" * 32,
            "STOCK_PLATFORM_MODEL_PROFILES_JSON": "[{\"id\":\"platform-sf\",\"name\":\"硅基流动\",\"provider\":\"siliconflow\",\"base_url\":\"https://api.siliconflow.cn/v1\",\"api_key_env\":\"STOCK_SILICONFLOW_API_KEY\"}]",
            "STOCK_SILICONFLOW_API_KEY": "platform-secret",
        }
    )

    assert settings.ai_profile_id == "platform-sf"
    assert settings.ai_api_key == "platform-secret"
    assert settings.ai_base_url == "https://api.siliconflow.cn/v1"


def test_database_migrates_existing_ai_reports_table(tmp_path: Path) -> None:
    database_path = tmp_path / "reports.db"
    import sqlite3

    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "CREATE TABLE ai_reports (id TEXT PRIMARY KEY, report_date TEXT NOT NULL, window_start DATETIME NOT NULL, window_end DATETIME NOT NULL, status TEXT NOT NULL, model_provider TEXT, model_name TEXT, title TEXT, summary_markdown TEXT, source_ids_json JSON, generated_at DATETIME, error_message TEXT)"
        )
        connection.commit()

    database = create_database(database_path)
    try:
        with database.engine.connect() as connection:
            columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(ai_reports)")}
        assert {"events_json", "risks_json"}.issubset(columns)
    finally:
        database.dispose()


def test_weekly_issue_is_unique_by_iso_week(tmp_path: Path) -> None:
    database = create_database(tmp_path / "reports.db")
    try:
        with database.sessions() as session:
            session.add(WeeklyIssue(iso_year=2026, iso_week=31, status="collecting"))
            session.commit()
            session.add(WeeklyIssue(iso_year=2026, iso_week=31, status="collecting"))
            with pytest.raises(IntegrityError):
                session.commit()
    finally:
        database.dispose()
