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
