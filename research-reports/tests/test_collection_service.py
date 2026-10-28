from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select

from research_reports.collector.types import TrendingRepository
from research_reports.database import create_database
from research_reports.models import (
    HourlyObservation,
    RankingEntry,
    Repository,
    WeeklyIssue,
)
from research_reports.services.collections import CollectionService


OBSERVED_AT = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)


def _row(category: str, full_name: str, rank: int = 1) -> TrendingRepository:
    return TrendingRepository(
        category=category,
        rank=rank,
        full_name=full_name,
        description=f"{full_name} description",
        primary_language=category.title(),
        stars_total=1000,
        forks_total=100,
        stars_since_weekly=200,
        contributor_urls=(),
        html_url=f"https://github.com/{full_name}",
    )


class PartialCollector:
    def fetch_trending(self, category: str):
        if category == "rust":
            raise ConnectionError("rust upstream unavailable")
        return [_row(category, "new/python-project")]


class MetadataCollector:
    def __init__(self) -> None:
        self.metadata_calls = 0

    def fetch_trending(self, category: str):
        return [_row(category, f"owner/{category}-project")]

    def fetch_metadata(self, full_name: str, *, etag: str | None):
        self.metadata_calls += 1
        raise AssertionError(f"metadata should be disabled: {full_name}")


def _seed(database) -> str:
    with database.sessions() as session:
        issue = WeeklyIssue(
            iso_year=2026,
            iso_week=31,
            starts_at=OBSERVED_AT,
            status="collecting",
        )
        repository = Repository(
            full_name="old/rust-project",
            owner="old",
            name="rust-project",
            html_url="https://github.com/old/rust-project",
        )
        session.add_all([issue, repository])
        session.flush()
        session.add(
            RankingEntry(
                issue_id=issue.id,
                repository_id=repository.id,
                category="rust",
                rank=1,
                status="new",
            )
        )
        session.commit()
        return issue.id


def _names(database, issue_id: str, category: str) -> list[str]:
    with database.sessions() as session:
        return list(
            session.scalars(
                select(Repository.full_name)
                .join(RankingEntry, RankingEntry.repository_id == Repository.id)
                .where(
                    RankingEntry.issue_id == issue_id,
                    RankingEntry.category == category,
                )
                .order_by(RankingEntry.rank)
            )
        )


def test_partial_failure_keeps_old_category_and_commits_success(tmp_path: Path) -> None:
    database = create_database(tmp_path / "reports.db")
    issue_id = _seed(database)
    service = CollectionService(
        database=database,
        collector=PartialCollector(),
        categories=("python", "rust"),
    )
    try:
        result = service.collect_all(
            trigger="scheduled_hourly",
            requested_by=None,
            observed_at=OBSERVED_AT,
        )

        assert result.status == "partial"
        assert result.categories["python"].status == "success"
        assert result.categories["rust"].status == "failed"
        assert _names(database, issue_id, "rust") == ["old/rust-project"]
        assert _names(database, issue_id, "python") == ["new/python-project"]
    finally:
        database.dispose()


def test_same_observation_time_is_idempotent(tmp_path: Path) -> None:
    database = create_database(tmp_path / "reports.db")
    _seed(database)
    service = CollectionService(
        database=database,
        collector=PartialCollector(),
        categories=("python",),
    )
    try:
        for _ in range(2):
            service.collect_all(
                trigger="manual",
                requested_by="site-user-1",
                observed_at=OBSERVED_AT,
            )
        with database.sessions() as session:
            count = session.scalar(select(func.count()).select_from(HourlyObservation))
        assert count == 1
    finally:
        database.dispose()


def test_public_collection_skips_optional_metadata_without_token(tmp_path: Path) -> None:
    database = create_database(tmp_path / "reports.db")
    collector = MetadataCollector()
    service = CollectionService(
        database=database,
        collector=collector,
        categories=("all",),
        metadata_enabled=False,
    )
    try:
        result = service.collect_all(
            trigger="manual",
            requested_by=None,
            observed_at=OBSERVED_AT,
        )
        assert result.categories["all"].status == "success"
        assert result.categories["all"].metadata_delayed is False
        assert collector.metadata_calls == 0
    finally:
        database.dispose()
