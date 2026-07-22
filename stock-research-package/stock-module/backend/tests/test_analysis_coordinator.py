from pathlib import Path

import pytest
from pydantic import ValidationError

from app.domain.analysis_tasks import AnalysisCreate, cache_key
from app.domain.model_profiles import StoredModelProfile
from app.repositories.analysis_tasks import AnalysisTaskRepository
from app.services.analysis_coordinator import AnalysisCoordinator


class ManualExecutor:
    def __init__(self) -> None:
        self.pending: tuple[object, tuple[object, ...]] | None = None

    def submit(self, function: object, *args: object) -> None:
        self.pending = (function, args)

    def run_pending(self) -> None:
        assert self.pending is not None
        function, args = self.pending
        self.pending = None
        function(*args)  # type: ignore[operator]


class RecordingAnalysisClient:
    def __init__(self, result: dict | None = None, error: Exception | None = None) -> None:
        self.result = result or {"success": True, "query_id": "q-1", "report": {"summary": "ok"}}
        self.error = error
        self.requests: list[dict] = []

    async def analyze(self, symbol: str, **request: object) -> dict:
        self.requests.append({"stock_code": symbol, **request})
        if self.error is not None:
            raise self.error
        return self.result


class FakeProfiles:
    def __init__(self, scope: str = "personal") -> None:
        self.scope = scope

    def get_available_record(self, profile_id: str) -> StoredModelProfile:
        owner_id = "platform" if self.scope == "platform" else "local"
        return StoredModelProfile.model_validate(
            {
                "id": profile_id,
                "owner_id": owner_id,
                "scope": self.scope,
                "name": "硅基流动",
                "provider": "siliconflow",
                "base_url": "https://api.siliconflow.cn/v1",
                "timeout_seconds": 120,
                "enabled": True,
                "secret_ref": profile_id,
                "created_at": "2026-07-21T00:00:00Z",
                "updated_at": "2026-07-21T00:00:00Z",
            }
        )


class RecordingIssuer:
    def issue(self, **claims: object) -> str:
        assert claims["ttl_seconds"] == 300
        return "short-lived-route-token"


def test_create_requires_explicit_model_and_main_board_symbol() -> None:
    with pytest.raises(ValidationError):
        AnalysisCreate(symbol="600519", profile_id="p1", model="")
    with pytest.raises(ValidationError):
        AnalysisCreate(symbol="300750", profile_id="p1", model="m1")


def test_cache_key_separates_model_owner_and_report() -> None:
    base = cache_key(owner="local", symbol="600519", profile="p1", model="m1", report="detailed")
    assert base != cache_key(owner="local", symbol="600519", profile="p1", model="m2", report="detailed")
    assert base != cache_key(owner="other", symbol="600519", profile="p1", model="m1", report="detailed")
    assert base != cache_key(owner="local", symbol="600519", profile="p1", model="m1", report="brief")


def test_coordinator_persists_success_and_sends_internal_route(tmp_path: Path) -> None:
    repository = AnalysisTaskRepository(tmp_path / "hub.db")
    executor = ManualExecutor()
    client = RecordingAnalysisClient()
    coordinator = AnalysisCoordinator(
        repository,
        FakeProfiles(),
        client,
        RecordingIssuer(),
        owner_id="local",
        executor=executor,
    )

    queued = coordinator.start(AnalysisCreate(symbol="sh600519", profile_id="p1", model="m1"))
    assert queued.state == "queued"
    assert "short-lived-route-token" not in queued.model_dump_json()
    executor.run_pending()

    completed = AnalysisTaskRepository(tmp_path / "hub.db").get(queued.task_id)
    assert completed is not None
    assert completed.state == "succeeded"
    assert completed.report == {"summary": "ok"}
    assert completed.upstream_query_id == "q-1"
    assert completed.started_at is not None
    assert completed.finished_at is not None
    request = client.requests[0]
    assert request["notify"] is False
    assert request["async_mode"] is False
    assert request["report_language"] == "zh"
    assert request["model"] == "m1"
    assert request["model_route_token"] == "short-lived-route-token"


def test_cache_hit_skips_upstream_and_force_refresh_bypasses_it(tmp_path: Path) -> None:
    repository = AnalysisTaskRepository(tmp_path / "hub.db")
    executor = ManualExecutor()
    client = RecordingAnalysisClient()
    coordinator = AnalysisCoordinator(
        repository, FakeProfiles(), client, RecordingIssuer(), owner_id="local", executor=executor
    )

    first = coordinator.start(AnalysisCreate(symbol="600519", profile_id="p1", model="m1"))
    executor.run_pending()
    cached = coordinator.start(AnalysisCreate(symbol="600519", profile_id="p1", model="m1"))
    assert cached.state == "succeeded"
    assert cached.cache_hit is True
    assert len(client.requests) == 1

    forced = coordinator.start(
        AnalysisCreate(symbol="600519", profile_id="p1", model="m1", force_refresh=True)
    )
    assert forced.state == "queued"
    executor.run_pending()
    assert len(client.requests) == 2


def test_platform_cache_is_shared_but_personal_cache_is_owner_scoped(tmp_path: Path) -> None:
    repository = AnalysisTaskRepository(tmp_path / "hub.db")
    platform_client = RecordingAnalysisClient()
    first_executor = ManualExecutor()
    first = AnalysisCoordinator(
        repository, FakeProfiles("platform"), platform_client, RecordingIssuer(),
        owner_id="user-a", executor=first_executor,
    )
    first.start(AnalysisCreate(symbol="600519", profile_id="platform-1", model="m1"))
    first_executor.run_pending()

    second = AnalysisCoordinator(
        repository, FakeProfiles("platform"), RecordingAnalysisClient(), RecordingIssuer(),
        owner_id="user-b", executor=ManualExecutor(),
    )
    shared = second.start(AnalysisCreate(symbol="600519", profile_id="platform-1", model="m1"))
    assert shared.cache_hit is True

    personal = AnalysisCoordinator(
        repository, FakeProfiles("personal"), RecordingAnalysisClient(), RecordingIssuer(),
        owner_id="user-b", executor=ManualExecutor(),
    )
    isolated = personal.start(AnalysisCreate(symbol="600519", profile_id="platform-1", model="m1"))
    assert isolated.state == "queued"
    assert isolated.cache_hit is False


def test_request_owner_cannot_read_another_users_analysis(tmp_path: Path) -> None:
    repository = AnalysisTaskRepository(tmp_path / "hub.db")
    executor = ManualExecutor()
    coordinator = AnalysisCoordinator(
        repository,
        FakeProfiles(),
        RecordingAnalysisClient(),
        RecordingIssuer(),
        owner_id="legacy-default",
        executor=executor,
    )

    task = coordinator.start(
        AnalysisCreate(symbol="600519", profile_id="p1", model="m1"),
        owner_id="user-a",
    )

    assert task.owner_id == "user-a"
    assert coordinator.get(task.task_id, owner_id="user-a") is not None
    assert coordinator.get(task.task_id, owner_id="user-b") is None


def test_failure_persists_only_safe_error(tmp_path: Path) -> None:
    repository = AnalysisTaskRepository(tmp_path / "hub.db")
    executor = ManualExecutor()
    client = RecordingAnalysisClient(error=RuntimeError("Bearer top-secret upstream traceback"))
    coordinator = AnalysisCoordinator(
        repository, FakeProfiles(), client, RecordingIssuer(), owner_id="local", executor=executor
    )

    task = coordinator.start(AnalysisCreate(symbol="600519", profile_id="p1", model="m1"))
    executor.run_pending()
    failed = repository.get(task.task_id)

    assert failed is not None
    assert failed.state == "failed"
    assert failed.error_code == "ANALYSIS_UPSTREAM_FAILED"
    assert "top-secret" not in failed.model_dump_json()
