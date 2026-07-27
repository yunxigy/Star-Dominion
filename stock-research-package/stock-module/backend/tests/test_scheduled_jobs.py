from datetime import UTC, datetime, timedelta

from app.repositories.job_leases import JobLeaseRepository
from app.services.scheduled_jobs import build_scheduler


def test_database_lease_prevents_duplicate_holder_until_expiry(tmp_path) -> None:
    repository = JobLeaseRepository(tmp_path / "hub.db")
    now = datetime(2026, 7, 27, tzinfo=UTC)

    assert repository.acquire("mom-index", "worker-1", now=now, ttl=timedelta(minutes=30))
    assert not repository.acquire("mom-index", "worker-2", now=now, ttl=timedelta(minutes=30))
    assert repository.acquire(
        "mom-index",
        "worker-2",
        now=now + timedelta(minutes=31),
        ttl=timedelta(minutes=30),
    )


def test_scheduler_uses_shanghai_0830_and_weekday_directory_jobs() -> None:
    scheduler = build_scheduler(
        timezone_name="Asia/Shanghai",
        mom_refresh=lambda: None,
        directory_refresh=lambda: None,
    )

    mom = scheduler.get_job("mom-index-refresh")
    directory = scheduler.get_job("stock-directory-refresh")
    assert str(mom.trigger) == "cron[hour='8', minute='30']"
    assert "day_of_week='mon-fri'" in str(directory.trigger)
