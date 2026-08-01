"""Reporting-week boundaries and collection scheduling."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from threading import Lock, Thread
import uuid
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select

from ..database import Database
from ..models import CollectionRun, WeeklyIssue


@dataclass(frozen=True, slots=True)
class ReportingWeek:
    year: int
    week: int
    boundary: datetime


@dataclass(frozen=True, slots=True)
class TriggerResult:
    accepted: bool
    status: str
    run_id: str | None


def reporting_week(now: datetime, timezone_value: ZoneInfo) -> ReportingWeek:
    local = now.astimezone(timezone_value)
    monday: date = local.date() - timedelta(days=local.weekday())
    boundary = datetime.combine(monday, time(hour=8, minute=30), timezone_value)
    if local < boundary:
        boundary -= timedelta(days=7)
    calendar = boundary.isocalendar()
    return ReportingWeek(year=calendar.year, week=calendar.week, boundary=boundary)


def ensure_active_issue(database: Database, now: datetime, timezone_value: ZoneInfo) -> str:
    active_week = reporting_week(now, timezone_value)
    boundary_utc = active_week.boundary.astimezone(timezone.utc)
    with database.sessions() as session:
        existing = session.scalar(
            select(WeeklyIssue).where(
                WeeklyIssue.iso_year == active_week.year,
                WeeklyIssue.iso_week == active_week.week,
            )
        )
        if existing is not None:
            return existing.id
        for issue in session.scalars(
            select(WeeklyIssue).where(
                WeeklyIssue.status.in_(("collecting", "delayed"))
            )
        ):
            issue.status = "sealed"
            issue.sealed_at = boundary_utc
        created = WeeklyIssue(
            iso_year=active_week.year,
            iso_week=active_week.week,
            starts_at=boundary_utc,
            status="collecting",
        )
        session.add(created)
        session.commit()
        return created.id


def _thread_executor(job: Callable[[], None]) -> Thread:
    thread = Thread(target=job, name="research-reports-collection", daemon=True)
    thread.start()
    return thread


class CollectionCoordinator:
    def __init__(
        self,
        *,
        database: Database,
        service,
        timezone: ZoneInfo,
        executor: Callable[[Callable[[], None]], object] = _thread_executor,
    ) -> None:
        self._database = database
        self._service = service
        self._timezone = timezone
        self._executor = executor
        self._lock = Lock()

    def trigger(self, *, trigger: str, requested_by: str | None) -> TriggerResult:
        if not self._lock.acquire(blocking=False):
            skipped_id = self.record_skipped_overlap(trigger)
            return TriggerResult(accepted=False, status="running", run_id=skipped_id)
        run_id = str(uuid.uuid4())

        def job() -> None:
            try:
                self._service.collect_all(
                    trigger=trigger,
                    requested_by=requested_by,
                    run_id=run_id,
                )
            finally:
                self._lock.release()

        try:
            self._executor(job)
        except Exception:
            self._lock.release()
            raise
        return TriggerResult(accepted=True, status="running", run_id=run_id)

    def hourly(self) -> TriggerResult:
        return self.trigger(trigger="scheduled_hourly", requested_by=None)

    def weekly_rollover(self, now: datetime | None = None) -> TriggerResult:
        if not self._lock.acquire(blocking=False):
            skipped_id = self.record_skipped_overlap("weekly_rollover")
            return TriggerResult(accepted=False, status="running", run_id=skipped_id)
        run_id = str(uuid.uuid4())
        current = now or datetime.now(self._timezone)

        def job() -> None:
            try:
                ensure_active_issue(self._database, current, self._timezone)
                self._service.collect_all(
                    trigger="weekly_rollover",
                    requested_by=None,
                    observed_at=current.astimezone(timezone.utc),
                    run_id=run_id,
                )
            finally:
                self._lock.release()

        try:
            self._executor(job)
        except Exception:
            self._lock.release()
            raise
        return TriggerResult(accepted=True, status="running", run_id=run_id)

    def record_skipped_overlap(self, trigger: str) -> str:
        with self._database.sessions() as session:
            run = CollectionRun(
                trigger=trigger,
                status="skipped_overlap",
                started_at=datetime.now(timezone.utc),
                finished_at=datetime.now(timezone.utc),
                categories_json={},
            )
            session.add(run)
            session.commit()
            return run.id


def build_scheduler(
    coordinator: CollectionCoordinator,
    timezone_value: ZoneInfo,
) -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=timezone_value)
    scheduler.add_job(
        coordinator.hourly,
        "cron",
        minute=0,
        id="hourly",
        max_instances=1,
        replace_existing=True,
    )
    scheduler.add_job(
        coordinator.weekly_rollover,
        "cron",
        day_of_week="mon",
        hour=8,
        minute=30,
        id="weekly-rollover",
        max_instances=1,
        replace_existing=True,
    )
    return scheduler
