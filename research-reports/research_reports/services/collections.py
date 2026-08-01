"""Collection orchestration with per-category transactional safety."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Protocol

from sqlalchemy import func, select

from ..collector.github import CATEGORIES
from ..collector.types import NotModified, RepositoryMetadata, TrendingRepository
from ..database import Database
from ..models import (
    CollectionRun,
    HourlyObservation,
    RankingEntry,
    Repository,
    WeeklyIssue,
)
from .rankings import classify_status


class TrendingCollector(Protocol):
    def fetch_trending(self, category: str) -> list[TrendingRepository]: ...


@dataclass(frozen=True, slots=True)
class CategoryCollectionResult:
    status: str
    count: int
    metadata_delayed: bool = False
    error_type: str | None = None


@dataclass(frozen=True, slots=True)
class CollectionResult:
    run_id: str
    status: str
    categories: dict[str, CategoryCollectionResult]


class CollectionService:
    def __init__(
        self,
        *,
        database: Database,
        collector: TrendingCollector,
        categories: tuple[str, ...] = CATEGORIES,
    ) -> None:
        unknown = set(categories) - set(CATEGORIES)
        if unknown:
            raise ValueError(f"Unsupported categories: {sorted(unknown)}")
        self._database = database
        self._collector = collector
        self._categories = categories

    def collect_all(
        self,
        *,
        trigger: str,
        requested_by: str | None,
        observed_at: datetime | None = None,
        run_id: str | None = None,
    ) -> CollectionResult:
        observed = observed_at or datetime.now(timezone.utc)
        started = monotonic()
        with self._database.sessions() as session:
            issue = session.scalar(
                select(WeeklyIssue)
                .where(WeeklyIssue.status.in_(("collecting", "delayed")))
                .order_by(WeeklyIssue.starts_at.desc())
            )
            if issue is None:
                calendar = observed.isocalendar()
                issue = WeeklyIssue(
                    iso_year=calendar.year,
                    iso_week=calendar.week,
                    starts_at=observed,
                    status="collecting",
                )
                session.add(issue)
                session.flush()
            run_values = dict(
                trigger=trigger,
                requested_by_site_user_id=requested_by,
                started_at=observed,
                status="running",
            )
            if run_id is not None:
                run_values["id"] = run_id
            run = CollectionRun(**run_values)
            session.add(run)
            session.commit()
            issue_id = issue.id
            run_id = run.id

        results: dict[str, CategoryCollectionResult] = {}
        for category in self._categories:
            try:
                rows = self._collector.fetch_trending(category)
                if not rows:
                    raise ValueError("collector returned an empty ranking")
                self._write_category(issue_id, category, rows, observed)
                metadata_delayed = self._enrich_metadata(rows, observed)
                results[category] = CategoryCollectionResult(
                    status="success",
                    count=len(rows),
                    metadata_delayed=metadata_delayed,
                )
            except Exception as exc:  # one category must not poison the others
                results[category] = CategoryCollectionResult(
                    status="failed",
                    count=0,
                    error_type=type(exc).__name__,
                )

        success_count = sum(result.status == "success" for result in results.values())
        status = (
            "success"
            if success_count == len(results)
            else "failed"
            if success_count == 0
            else "partial"
        )
        duration_ms = round((monotonic() - started) * 1000)
        failed_types = sorted(
            {
                result.error_type
                for result in results.values()
                if result.error_type is not None
            }
        )
        with self._database.sessions() as session:
            run = session.get(CollectionRun, run_id)
            if run is not None:
                run.status = status
                run.finished_at = datetime.now(timezone.utc)
                run.duration_ms = duration_ms
                run.categories_json = {
                    category: asdict(result) for category, result in results.items()
                }
                run.error_summary = ", ".join(failed_types) or None
                session.commit()
        return CollectionResult(run_id=run_id, status=status, categories=results)

    def _write_category(
        self,
        issue_id: str,
        category: str,
        rows: list[TrendingRepository],
        observed_at: datetime,
    ) -> None:
        with self._database.sessions() as session:
            issue = session.get(WeeklyIssue, issue_id)
            if issue is None:
                raise LookupError("active weekly issue does not exist")
            previous_issue = session.scalar(
                select(WeeklyIssue)
                .where(WeeklyIssue.starts_at < issue.starts_at)
                .order_by(WeeklyIssue.starts_at.desc())
            )
            previous_ranks: dict[str, int] = {}
            if previous_issue is not None:
                previous_ranks = dict(
                    session.execute(
                        select(Repository.full_name, RankingEntry.rank)
                        .join(RankingEntry, RankingEntry.repository_id == Repository.id)
                        .where(
                            RankingEntry.issue_id == previous_issue.id,
                            RankingEntry.category == category,
                        )
                    ).all()
                )
            history_names = set(
                session.scalars(
                    select(Repository.full_name)
                    .join(RankingEntry, RankingEntry.repository_id == Repository.id)
                    .join(WeeklyIssue, WeeklyIssue.id == RankingEntry.issue_id)
                    .where(
                        WeeklyIssue.starts_at < issue.starts_at,
                        RankingEntry.category == category,
                    )
                )
            )
            existing = {
                entry.repository_id: entry
                for entry in session.scalars(
                    select(RankingEntry).where(
                        RankingEntry.issue_id == issue_id,
                        RankingEntry.category == category,
                    )
                )
            }
            seen_repository_ids: set[str] = set()
            for row in rows:
                repository = session.scalar(
                    select(Repository).where(
                        func.lower(Repository.full_name) == row.full_name.lower()
                    )
                )
                if repository is None:
                    owner, name = row.full_name.split("/", 1)
                    repository = Repository(
                        full_name=row.full_name,
                        owner=owner,
                        name=name,
                        html_url=row.html_url,
                    )
                    session.add(repository)
                    session.flush()
                repository.description = row.description
                repository.primary_language = row.primary_language
                repository.stars_total = row.stars_total
                repository.forks_total = row.forks_total
                repository.updated_at = observed_at

                previous_rank = previous_ranks.get(repository.full_name)
                status = classify_status(
                    repository.full_name,
                    current_rank=row.rank,
                    previous_rank=previous_rank,
                    history={name: () for name in history_names},
                )
                entry = existing.get(repository.id)
                if entry is None:
                    entry = RankingEntry(
                        issue_id=issue_id,
                        repository_id=repository.id,
                        category=category,
                        first_seen_at=observed_at,
                    )
                    session.add(entry)
                entry.rank = row.rank
                entry.previous_issue_rank = previous_rank
                entry.stars_since_weekly = row.stars_since_weekly
                entry.last_seen_at = observed_at
                entry.status = status
                entry.consecutive_weeks = self._consecutive_count(
                    session,
                    repository.id,
                    category,
                    issue.starts_at,
                )
                seen_repository_ids.add(repository.id)

                observation = session.scalar(
                    select(HourlyObservation).where(
                        HourlyObservation.issue_id == issue_id,
                        HourlyObservation.repository_id == repository.id,
                        HourlyObservation.category == category,
                        HourlyObservation.observed_at == observed_at,
                    )
                )
                if observation is None:
                    session.add(
                        HourlyObservation(
                            issue_id=issue_id,
                            repository_id=repository.id,
                            category=category,
                            observed_at=observed_at,
                            rank=row.rank,
                            stars_total=row.stars_total,
                            stars_since_weekly=row.stars_since_weekly,
                        )
                    )
            for repository_id, entry in existing.items():
                if repository_id not in seen_repository_ids:
                    session.delete(entry)
            session.commit()

    @staticmethod
    def _consecutive_count(session, repository_id: str, category: str, starts_at: datetime) -> int:
        prior_presence = list(
            session.execute(
                select(WeeklyIssue.id, RankingEntry.id)
                .outerjoin(
                    RankingEntry,
                    (RankingEntry.issue_id == WeeklyIssue.id)
                    & (RankingEntry.repository_id == repository_id)
                    & (RankingEntry.category == category),
                )
                .where(WeeklyIssue.starts_at < starts_at)
                .order_by(WeeklyIssue.starts_at.desc())
            ).all()
        )
        count = 1
        for _, entry_id in prior_presence:
            if entry_id is None:
                break
            count += 1
        return count

    def _enrich_metadata(
        self,
        rows: list[TrendingRepository],
        observed_at: datetime,
    ) -> bool:
        fetch_metadata = getattr(self._collector, "fetch_metadata", None)
        if not callable(fetch_metadata):
            return False
        delayed = False
        for row in rows:
            with self._database.sessions() as session:
                repository = session.scalar(
                    select(Repository).where(
                        func.lower(Repository.full_name) == row.full_name.lower()
                    )
                )
                if repository is None:
                    continue
                if (
                    repository.metadata_checked_at is not None
                    and repository.metadata_checked_at >= observed_at - timedelta(hours=24)
                ):
                    continue
                try:
                    metadata = fetch_metadata(
                        repository.full_name,
                        etag=repository.metadata_etag,
                    )
                    if isinstance(metadata, NotModified):
                        repository.metadata_etag = metadata.etag
                    elif isinstance(metadata, RepositoryMetadata):
                        repository.description = metadata.description or repository.description
                        repository.primary_language = (
                            metadata.primary_language or repository.primary_language
                        )
                        repository.topics_json = list(metadata.topics)
                        repository.license_spdx = metadata.license_spdx
                        repository.default_branch = metadata.default_branch
                        repository.is_archived = metadata.is_archived
                        repository.stars_total = metadata.stars_total
                        repository.forks_total = metadata.forks_total
                        repository.github_updated_at = metadata.github_updated_at
                        repository.metadata_etag = metadata.etag
                    repository.metadata_checked_at = observed_at
                    session.commit()
                except Exception:
                    session.rollback()
                    delayed = True
        return delayed
