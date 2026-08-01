from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from research_reports.database import create_database
from research_reports.models import CollectionRun, WeeklyIssue
from research_reports.services.scheduler import (
    CollectionCoordinator,
    ensure_active_issue,
    reporting_week,
)


SHANGHAI = ZoneInfo("Asia/Shanghai")


def test_reporting_week_changes_only_at_monday_0830() -> None:
    before = reporting_week(datetime(2026, 8, 3, 8, 29, tzinfo=SHANGHAI), SHANGHAI)
    after = reporting_week(datetime(2026, 8, 3, 8, 30, tzinfo=SHANGHAI), SHANGHAI)

    assert before.week == 31
    assert after.week == 32
    assert after.boundary.hour == 8
    assert after.boundary.minute == 30


def test_ensure_active_issue_is_idempotent_and_seals_previous(tmp_path: Path) -> None:
    database = create_database(tmp_path / "reports.db")
    try:
        first = ensure_active_issue(
            database,
            datetime(2026, 7, 27, 8, 30, tzinfo=SHANGHAI),
            SHANGHAI,
        )
        second = ensure_active_issue(
            database,
            datetime(2026, 8, 3, 8, 30, tzinfo=SHANGHAI),
            SHANGHAI,
        )
        repeated = ensure_active_issue(
            database,
            datetime(2026, 8, 3, 9, 0, tzinfo=SHANGHAI),
            SHANGHAI,
        )
        with database.sessions() as session:
            count = session.scalar(select(func.count()).select_from(WeeklyIssue))
            old = session.get(WeeklyIssue, first)
        assert second == repeated
        assert count == 2
        assert old.status == "sealed"
        assert old.sealed_at is not None
    finally:
        database.dispose()


class FakeCollectionService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str | None]] = []

    def collect_all(self, *, trigger, requested_by, observed_at=None, run_id=None):
        self.calls.append((trigger, requested_by))
        return type("Result", (), {"run_id": run_id, "status": "success"})()


def test_coordinator_rejects_overlap_until_job_finishes(tmp_path: Path) -> None:
    database = create_database(tmp_path / "reports.db")
    pending = []
    service = FakeCollectionService()
    coordinator = CollectionCoordinator(
        database=database,
        service=service,
        timezone=SHANGHAI,
        executor=pending.append,
    )
    try:
        first = coordinator.trigger(trigger="manual", requested_by="admin")
        second = coordinator.trigger(trigger="manual", requested_by="admin")
        assert first.accepted is True
        assert first.run_id is not None
        assert second.accepted is False
        with database.sessions() as session:
            skipped = session.scalar(
                select(CollectionRun).where(CollectionRun.status == "skipped_overlap")
            )
        assert skipped is not None
        pending.pop()()
        third = coordinator.trigger(trigger="manual", requested_by="admin")
        assert third.accepted is True
    finally:
        database.dispose()
