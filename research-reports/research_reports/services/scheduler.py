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
from ..models import AICollectionRun, CollectionRun, WeeklyIssue


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


class NewsCoordinator:
    """Independent coordinator for scheduled news collection with lock and run tracking."""

    def __init__(
        self,
        *,
        database: Database,
        timezone: ZoneInfo,
        executor: Callable[[Callable[[], None]], object] = _thread_executor,
    ) -> None:
        self._database = database
        self._timezone = timezone
        self._executor = executor
        self._lock = Lock()

    def trigger(self, *, trigger: str = "scheduled_news") -> TriggerResult:
        if not self._lock.acquire(blocking=False):
            skipped_id = self._record_skipped(trigger)
            return TriggerResult(accepted=False, status="running", run_id=skipped_id)
        run_id = str(uuid.uuid4())

        def job() -> None:
            import httpx
            from .news_collection import collect_public_news
            now = datetime.now(timezone.utc)
            try:
                with self._database.sessions() as session:
                    run = AICollectionRun(
                        id=run_id,
                        domain="news",
                        trigger=trigger,
                        started_at=now,
                        status="running",
                    )
                    session.add(run)
                    session.commit()
                with httpx.Client() as http:
                    counts = collect_public_news(self._database, http=http, now=now)
                success_count = sum(1 for v in counts.values() if v > 0)
                total_sources = len(counts)
                status = "success" if success_count == total_sources else ("partial" if success_count > 0 else "failed")
                with self._database.sessions() as session:
                    run = session.get(AICollectionRun, run_id)
                    if run is not None:
                        run.status = status
                        run.finished_at = datetime.now(timezone.utc)
                        run.counts_json = counts
                        session.commit()
            except Exception as exc:
                with self._database.sessions() as session:
                    run = session.get(AICollectionRun, run_id)
                    if run is not None:
                        run.status = "failed"
                        run.finished_at = datetime.now(timezone.utc)
                        run.error_summary = type(exc).__name__
                        session.commit()
            finally:
                self._lock.release()

        try:
            self._executor(job)
        except Exception:
            self._lock.release()
            raise
        return TriggerResult(accepted=True, status="running", run_id=run_id)

    def _record_skipped(self, trigger: str) -> str:
        with self._database.sessions() as session:
            run = AICollectionRun(
                domain="news",
                trigger=trigger,
                status="skipped_overlap",
                started_at=datetime.now(timezone.utc),
                finished_at=datetime.now(timezone.utc),
                counts_json={},
            )
            session.add(run)
            session.commit()
            return run.id


class BriefingCoordinator:
    """Independent coordinator for scheduled AI briefing generation with lock and run tracking."""

    def __init__(
        self,
        *,
        database: Database,
        ai_client,
        timezone: ZoneInfo,
        executor: Callable[[Callable[[], None]], object] = _thread_executor,
    ) -> None:
        self._database = database
        self._ai_client = ai_client
        self._timezone = timezone
        self._executor = executor
        self._lock = Lock()

    def trigger(self, *, trigger: str = "scheduled_briefing") -> TriggerResult:
        if not self._lock.acquire(blocking=False):
            skipped_id = self._record_skipped(trigger)
            return TriggerResult(accepted=False, status="running", run_id=skipped_id)
        run_id = str(uuid.uuid4())

        def job() -> None:
            from .briefings import BriefingService
            from ..models import AIReport, NewsItem
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(hours=24)
            try:
                with self._database.sessions() as session:
                    run = AICollectionRun(
                        id=run_id,
                        domain="briefing",
                        trigger=trigger,
                        started_at=now,
                        status="running",
                    )
                    session.add(run)
                    session.commit()
                # Gather news items for briefing
                with self._database.sessions() as session:
                    rows = list(session.scalars(
                        select(NewsItem)
                        .where(NewsItem.published_at >= cutoff)
                        .order_by(NewsItem.importance_score.desc(), NewsItem.published_at.desc())
                        .limit(50)
                    ))
                from ..collector.rss import RSSItem
                items = [RSSItem(row.source_id, row.canonical_url, row.title, row.summary, row.published_at, row.author_or_publisher, row.content_hash) for row in rows]
                ai_client = self._ai_client
                if ai_client is None:
                    class MissingAI:
                        def generate(self, **kwargs):
                            raise RuntimeError("AI provider is not configured")
                    ai_client = MissingAI()
                result = BriefingService(ai_client=ai_client).generate(items, now=now)
                with self._database.sessions() as session:
                    report = session.scalar(select(AIReport).where(AIReport.report_date == now.date().isoformat()))
                    if report is None:
                        report = AIReport(report_date=now.date().isoformat(), window_start=cutoff, window_end=now, status=result.status)
                        session.add(report)
                    report.window_start = cutoff
                    report.window_end = now
                    report.status = result.status
                    report.model_provider = "siliconflow" if result.model else None
                    report.model_name = result.model
                    report.title = result.title
                    report.summary_markdown = result.summary
                    report.events_json = [dict(e) if isinstance(e, dict) else {"data": str(e)} for e in result.events]
                    report.risks_json = list(result.risks)
                    report.source_ids_json = list(result.source_ids)
                    report.generated_at = now
                    report.error_message = None if result.status == "success" else "AI provider unavailable"
                    session.commit()
                with self._database.sessions() as session:
                    run = session.get(AICollectionRun, run_id)
                    if run is not None:
                        run.status = result.status
                        run.finished_at = datetime.now(timezone.utc)
                        run.counts_json = {"items_used": len(items), "events": len(result.events)}
                        session.commit()
            except Exception as exc:
                with self._database.sessions() as session:
                    run = session.get(AICollectionRun, run_id)
                    if run is not None:
                        run.status = "failed"
                        run.finished_at = datetime.now(timezone.utc)
                        run.error_summary = type(exc).__name__
                        session.commit()
            finally:
                self._lock.release()

        try:
            self._executor(job)
        except Exception:
            self._lock.release()
            raise
        return TriggerResult(accepted=True, status="running", run_id=run_id)

    def _record_skipped(self, trigger: str) -> str:
        with self._database.sessions() as session:
            run = AICollectionRun(
                domain="briefing",
                trigger=trigger,
                status="skipped_overlap",
                started_at=datetime.now(timezone.utc),
                finished_at=datetime.now(timezone.utc),
                counts_json={},
            )
            session.add(run)
            session.commit()
            return run.id


def build_scheduler(
    coordinator: CollectionCoordinator,
    timezone_value: ZoneInfo,
    news_coordinator: NewsCoordinator | None = None,
    briefing_coordinator: BriefingCoordinator | None = None,
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
    if news_coordinator is not None:
        scheduler.add_job(
            news_coordinator.trigger,
            "cron",
            minute="0,30",
            id="news-collection",
            max_instances=1,
            replace_existing=True,
        )
    if briefing_coordinator is not None:
        scheduler.add_job(
            briefing_coordinator.trigger,
            "cron",
            hour=8,
            minute=30,
            id="daily-briefing",
            max_instances=1,
            replace_existing=True,
        )
    return scheduler