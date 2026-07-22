"""Background orchestration for candidate snapshot workers and ingestion."""

from concurrent.futures import Executor, ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Protocol

from app.integrations.candidate_workers import WorkerResult
from app.repositories.refresh_tasks import RefreshTask, RefreshTaskRepository
from app.services.candidate_refresh import CandidateCollection


class CandidateWorker(Protocol):
    def run(self) -> WorkerResult: ...


class RefreshableCandidateService(Protocol):
    def refresh(self) -> CandidateCollection: ...


class RefreshableMorningReportService(Protocol):
    def refresh(self) -> object: ...


class CandidateRefreshCoordinator:
    def __init__(
        self,
        repository: RefreshTaskRepository,
        candidate_service: RefreshableCandidateService,
        workers: list[CandidateWorker],
        *,
        morning_report_service: RefreshableMorningReportService | None = None,
        executor: Executor | None = None,
    ) -> None:
        self._repository = repository
        self._candidate_service = candidate_service
        self._workers = workers
        self._morning_report_service = morning_report_service
        self._owns_executor = executor is None
        self._executor = executor or ThreadPoolExecutor(max_workers=1, thread_name_prefix="candidate-refresh")

    def start(self) -> RefreshTask:
        task = self._repository.create()
        self._executor.submit(self.run, task.task_id)
        return task

    def get(self, task_id: str) -> RefreshTask | None:
        return self._repository.get(task_id)

    def run(self, task_id: str) -> None:
        task = self._repository.get(task_id)
        if task is None:
            return
        task.status = "running"
        task.started_at = datetime.now(UTC)
        self._repository.save(task)

        try:
            worker_results = [worker.run() for worker in self._workers]
            morning_report_failed = False
            if self._morning_report_service is not None:
                try:
                    self._morning_report_service.refresh()
                except Exception:
                    morning_report_failed = True
            collection = self._candidate_service.refresh()
            usable = any(status.status in {"ok", "stale"} for status in collection.sources)
            has_issues = (
                morning_report_failed
                or any(result.status != "succeeded" for result in worker_results)
                or any(
                    status.status in {"stale", "error", "not_configured"}
                    for status in collection.sources
                )
            )
            task.worker_results = worker_results
            task.source_statuses = collection.sources
            task.status = "failed" if not usable else "partial" if has_issues else "succeeded"
            task.message = _message_for(task.status)
        except Exception:
            task.status = "failed"
            task.message = "刷新任务执行异常"
        task.finished_at = datetime.now(UTC)
        self._repository.save(task)

    def shutdown(self) -> None:
        if self._owns_executor and isinstance(self._executor, ThreadPoolExecutor):
            self._executor.shutdown(wait=False, cancel_futures=False)


def _message_for(status: str) -> str:
    if status == "succeeded":
        return "全部候选来源刷新成功"
    if status == "partial":
        return "部分来源失败，已保留可用结果"
    return "没有可用的候选快照"
