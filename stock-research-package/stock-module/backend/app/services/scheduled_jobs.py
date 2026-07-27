"""Timezone-aware schedules protected by SQLite leases."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Callable
from uuid import uuid4

from apscheduler.schedulers.background import BackgroundScheduler
from pydantic import BaseModel

from app.repositories.job_leases import JobLeaseRepository


class BackgroundJobTask(BaseModel):
    task_id: str
    job_name: str
    status: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    message: str | None = None


class BackgroundOperationCoordinator:
    def __init__(
        self,
        *,
        job_name: str,
        operation: Callable[[], object],
        leases: JobLeaseRepository,
        lease_ttl: timedelta = timedelta(minutes=30),
    ) -> None:
        self._job_name = job_name
        self._operation = operation
        self._leases = leases
        self._lease_ttl = lease_ttl
        self._tasks: dict[str, BackgroundJobTask] = {}
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=job_name)

    def start(self) -> BackgroundJobTask:
        task = BackgroundJobTask(
            task_id=str(uuid4()),
            job_name=self._job_name,
            status="queued",
            created_at=datetime.now(UTC),
        )
        self._tasks[task.task_id] = task
        self._executor.submit(self.run, task.task_id)
        return task

    def run(self, task_id: str) -> None:
        task = self._tasks.get(task_id)
        if task is None:
            return
        holder = task.task_id
        now = datetime.now(UTC)
        if not self._leases.acquire(
            self._job_name,
            holder,
            now=now,
            ttl=self._lease_ttl,
        ):
            task.status = "skipped"
            task.finished_at = now
            task.message = "已有同类任务运行"
            return
        task.status = "running"
        task.started_at = now
        try:
            self._operation()
            task.status = "succeeded"
            task.message = "刷新完成"
        except Exception as exc:
            task.status = "failed"
            task.message = str(exc)[:240]
        finally:
            task.finished_at = datetime.now(UTC)
            self._leases.release(self._job_name, holder)

    def get(self, task_id: str) -> BackgroundJobTask | None:
        return self._tasks.get(task_id)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=False)


def build_scheduler(
    *,
    timezone_name: str,
    mom_refresh: Callable[[], object],
    directory_refresh: Callable[[], object],
    mom_refresh_time: str = "08:30",
) -> BackgroundScheduler:
    hour_text, minute_text = mom_refresh_time.split(":", maxsplit=1)
    scheduler = BackgroundScheduler(timezone=timezone_name)
    scheduler.add_job(
        mom_refresh,
        "cron",
        id="mom-index-refresh",
        hour=int(hour_text),
        minute=int(minute_text),
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.add_job(
        directory_refresh,
        "cron",
        id="stock-directory-refresh",
        day_of_week="mon-fri",
        hour=7,
        minute=45,
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    return scheduler
