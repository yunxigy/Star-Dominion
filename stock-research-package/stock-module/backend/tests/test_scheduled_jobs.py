import base64
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.config import Settings
from app.main import create_app
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


def test_scheduler_adds_daily_candidate_refresh_at_configured_time() -> None:
    scheduler = build_scheduler(
        timezone_name="Asia/Shanghai",
        mom_refresh=lambda: None,
        directory_refresh=lambda: None,
        candidate_refresh=lambda: None,
        candidate_refresh_time="09:00",
    )

    candidate = scheduler.get_job("candidate-refresh")

    assert candidate is not None
    assert str(candidate.trigger) == "cron[hour='9', minute='0']"
    assert candidate.coalesce is True
    assert candidate.max_instances == 1


class CapturingScheduler:
    def start(self) -> None:
        return None

    def shutdown(self, *, wait: bool = False) -> None:
        return None


class FakeCandidateRefreshCoordinator:
    def start(self):
        raise AssertionError("scheduler callback must not run during app construction")

    def get(self, _task_id):
        return None

    def shutdown(self) -> None:
        return None


def test_app_wires_candidate_coordinator_into_scheduler(
    monkeypatch,
    tmp_path: Path,
) -> None:
    captured = {}

    def fake_build_scheduler(**kwargs):
        captured.update(kwargs)
        return CapturingScheduler()

    monkeypatch.setattr("app.main.build_scheduler", fake_build_scheduler)
    coordinator = FakeCandidateRefreshCoordinator()
    settings = Settings(
        data_dir=tmp_path / "data",
        catalyst_report_path=tmp_path / "cat.json",
        user_strategy_snapshot_path=tmp_path / "strategy.json",
        model_master_key=base64.urlsafe_b64encode(b"m" * 32).decode("ascii"),
        gateway_service_token="g" * 32,
        route_signing_key="r" * 32,
        site_auth_internal_key="s" * 32,
        candidate_refresh_time="09:00",
    )

    create_app(settings=settings, refresh_coordinator=coordinator)

    assert captured["candidate_refresh"].__self__ is coordinator
    assert captured["candidate_refresh_time"] == "09:00"
