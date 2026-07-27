from pathlib import Path

from app.integrations.candidate_workers import WorkerResult
from app.repositories.refresh_tasks import RefreshTaskRepository
from app.services.candidate_refresh import CandidateCollection, CandidateSourceStatus
from app.services.refresh_coordinator import CandidateRefreshCoordinator


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


class FakeWorker:
    def __init__(self, result: WorkerResult) -> None:
        self.result = result

    def run(self) -> WorkerResult:
        return self.result

    @property
    def source_name(self) -> str:
        return self.result.source_name


class FakeCandidateService:
    def __init__(self, collection: CandidateCollection) -> None:
        self.collection = collection
        self.refresh_calls = 0

    def refresh(self) -> CandidateCollection:
        self.refresh_calls += 1
        return self.collection


class FakeMorningReportService:
    def __init__(self, events: list[str], *, fails: bool = False) -> None:
        self.events = events
        self.fails = fails

    def refresh(self) -> object:
        self.events.append("morning")
        if self.fails:
            raise RuntimeError("morning failed")
        return object()


def test_start_persists_queued_task_and_completed_state_survives_restart(tmp_path: Path) -> None:
    repository = RefreshTaskRepository(tmp_path / "hub.db")
    executor = ManualExecutor()
    service = FakeCandidateService(_collection("ok"))
    coordinator = CandidateRefreshCoordinator(repository, service, [_worker("succeeded")], executor=executor)

    queued = coordinator.start()
    assert queued.status == "queued"
    executor.run_pending()

    restarted = RefreshTaskRepository(tmp_path / "hub.db").get(queued.task_id)
    assert restarted is not None
    assert restarted.status == "succeeded"
    assert restarted.started_at is not None
    assert restarted.finished_at is not None
    assert service.refresh_calls == 1


def test_failed_worker_with_usable_source_finishes_partial(tmp_path: Path) -> None:
    repository = RefreshTaskRepository(tmp_path / "hub.db")
    executor = ManualExecutor()
    coordinator = CandidateRefreshCoordinator(
        repository,
        FakeCandidateService(_collection("ok")),
        [_worker("failed")],
        executor=executor,
    )

    task = coordinator.start()
    executor.run_pending()
    completed = coordinator.get(task.task_id)

    assert completed is not None
    assert completed.status == "partial"
    assert completed.worker_results[0].status == "failed"


def test_all_sources_unavailable_finishes_failed(tmp_path: Path) -> None:
    repository = RefreshTaskRepository(tmp_path / "hub.db")
    executor = ManualExecutor()
    coordinator = CandidateRefreshCoordinator(
        repository,
        FakeCandidateService(_collection("error")),
        [_worker("failed")],
        executor=executor,
    )

    task = coordinator.start()
    executor.run_pending()

    assert coordinator.get(task.task_id).status == "failed"  # type: ignore[union-attr]


def test_morning_report_refresh_runs_before_candidate_ingestion(tmp_path: Path) -> None:
    events: list[str] = []

    class OrderedCandidateService(FakeCandidateService):
        def refresh(self) -> CandidateCollection:
            events.append("candidates")
            return super().refresh()

    executor = ManualExecutor()
    coordinator = CandidateRefreshCoordinator(
        RefreshTaskRepository(tmp_path / "hub.db"),
        OrderedCandidateService(_collection("ok")),
        [_worker("succeeded")],
        morning_report_service=FakeMorningReportService(events),
        executor=executor,
    )

    coordinator.start()
    executor.run_pending()

    assert events == ["morning", "candidates"]


def test_morning_report_failure_with_usable_candidates_is_partial(tmp_path: Path) -> None:
    events: list[str] = []
    executor = ManualExecutor()
    coordinator = CandidateRefreshCoordinator(
        RefreshTaskRepository(tmp_path / "hub.db"),
        FakeCandidateService(_collection("ok")),
        [_worker("succeeded")],
        morning_report_service=FakeMorningReportService(events, fails=True),
        executor=executor,
    )

    task = coordinator.start()
    executor.run_pending()

    assert coordinator.get(task.task_id).status == "partial"  # type: ignore[union-attr]


def test_persists_current_worker_message_while_refresh_is_running(tmp_path: Path) -> None:
    repository = RefreshTaskRepository(tmp_path / "hub.db")
    executor = ManualExecutor()
    observed_messages: list[str | None] = []
    task_id = ""

    class InspectingWorker(FakeWorker):
        def run(self) -> WorkerResult:
            observed_messages.append(repository.get(task_id).message)  # type: ignore[union-attr]
            return super().run()

    worker = InspectingWorker(_worker("succeeded").result)
    coordinator = CandidateRefreshCoordinator(
        repository,
        FakeCandidateService(_collection("ok")),
        [worker],
        executor=executor,
    )
    task_id = coordinator.start().task_id

    executor.run_pending()

    assert observed_messages == ["正在运行 九点猫研（1/1）"]


def _worker(status: str) -> FakeWorker:
    return FakeWorker(
        WorkerResult(
            source_id="catalyst",
            source_name="九点猫研",
            status=status,
            exit_code=0 if status == "succeeded" else 1,
            duration_ms=10,
            summary="完成" if status == "succeeded" else "失败",
        )
    )


def _collection(status: str) -> CandidateCollection:
    return CandidateCollection(
        items=[],
        sources=[
            CandidateSourceStatus(
                source_id="catalyst",
                source_name="九点猫研",
                status=status,
            )
        ],
    )
