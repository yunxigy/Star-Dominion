from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Protocol

from .config import VideoSettings
from .errors import ServiceError
from .extractor import (
    DownloadCancelled,
    DownloadHooks,
    DownloadSpec,
    ExtractedVideo,
)
from .files import JobFiles
from .models import ErrorBody
from .url_policy import ResolvedVideoUrl


class Downloader(Protocol):
    def download(self, spec: DownloadSpec, hooks: DownloadHooks) -> Path:
        raise NotImplementedError


class JobStatus(StrEnum):
    QUEUED = "queued"
    EXTRACTING = "extracting"
    DOWNLOADING = "downloading"
    MERGING = "merging"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


TERMINAL_STATUSES = {
    JobStatus.COMPLETED,
    JobStatus.FAILED,
    JobStatus.CANCELLED,
    JobStatus.EXPIRED,
}
ACTIVE_STATUSES = {
    JobStatus.QUEUED,
    JobStatus.EXTRACTING,
    JobStatus.DOWNLOADING,
    JobStatus.MERGING,
}


@dataclass
class DownloadJob:
    id: str
    session_digest: str
    client_ip: str
    parsed_video: ExtractedVideo
    quality_id: str
    directory: Path
    created_at: float
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    speed_bytes_per_second: float | None = None
    output_path: Path | None = None
    error: ErrorBody | None = None
    started_at: float | None = None
    completed_at: float | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)


class _JobProgressHooks:
    def __init__(self, manager: "JobManager", job: DownloadJob) -> None:
        self._manager = manager
        self._job = job

    def extracting(self) -> None:
        with self._manager._lock:
            self._manager._raise_if_cancelled(self._job)
            self._job.status = JobStatus.EXTRACTING
            self._job.progress = max(self._job.progress, 1.0)

    def downloading(
        self,
        downloaded_bytes: int,
        total_bytes: int | None,
        speed_bytes_per_second: float | None,
    ) -> None:
        with self._manager._lock:
            self._manager._raise_if_cancelled(self._job)
            downloaded = max(0, int(downloaded_bytes))
            if downloaded > self._manager._settings.max_file_bytes:
                self._job.cancel_event.set()
                raise ServiceError(
                    "FILE_SIZE_LIMIT",
                    "视频实际下载大小超过当前服务限制。",
                    413,
                )
            self._job.status = JobStatus.DOWNLOADING
            self._job.downloaded_bytes = downloaded
            self._job.total_bytes = total_bytes if total_bytes and total_bytes > 0 else None
            self._job.speed_bytes_per_second = speed_bytes_per_second
            if self._job.total_bytes:
                ratio = min(downloaded / self._job.total_bytes, 1.0)
                self._job.progress = 5.0 + ratio * 85.0
            else:
                self._job.progress = max(self._job.progress, 5.0)

    def merging(self) -> None:
        with self._manager._lock:
            self._manager._raise_if_cancelled(self._job)
            self._job.status = JobStatus.MERGING
            self._job.progress = max(self._job.progress, 95.0)

    def completed(self, output_path: Path) -> None:
        with self._manager._lock:
            self._manager._raise_if_cancelled(self._job)
            self._job.output_path = output_path
            self._job.progress = max(self._job.progress, 99.0)


class JobManager:
    def __init__(
        self,
        settings: VideoSettings,
        downloader: Downloader,
        files: JobFiles | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._settings = settings
        self._downloader = downloader
        self._files = files or JobFiles(settings.temp_dir)
        self._clock = clock or time.time
        self._queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=settings.max_queue_size)
        self._jobs: dict[str, DownloadJob] = {}
        self._done_events: dict[str, asyncio.Event] = {}
        self._workers: list[asyncio.Task[None]] = []
        self._cleanup_task: asyncio.Task[None] | None = None
        self._lock = threading.RLock()
        self._started = False
        self._stopping = False

    async def start(self) -> None:
        if self._started:
            return
        self._files.ensure_root()
        self._files.cleanup_orphans()
        self._stopping = False
        self._workers = [
            asyncio.create_task(self._worker(), name=f"video-download-worker-{index}")
            for index in range(self._settings.global_download_concurrency)
        ]
        self._cleanup_task = asyncio.create_task(
            self._cleanup_loop(),
            name="video-download-cleanup",
        )
        self._started = True

    async def stop(self) -> None:
        if self._stopping:
            return
        self._stopping = True

        with self._lock:
            active_jobs = [job for job in self._jobs.values() if job.status in ACTIVE_STATUSES]
            for job in active_jobs:
                job.cancel_event.set()
                if job.status is JobStatus.QUEUED:
                    self._cancel_queued(job)

        if self._started:
            for _worker in self._workers:
                await self._queue.put(None)
            try:
                await asyncio.wait_for(
                    asyncio.gather(*self._workers, return_exceptions=True),
                    timeout=5,
                )
            except TimeoutError:
                for worker in self._workers:
                    worker.cancel()
                await asyncio.gather(*self._workers, return_exceptions=True)

        if self._cleanup_task is not None:
            self._cleanup_task.cancel()
            await asyncio.gather(self._cleanup_task, return_exceptions=True)
        self._workers.clear()
        self._cleanup_task = None
        self._started = False

    async def enqueue(
        self,
        session_digest: str,
        client_ip: str,
        parsed_video: ExtractedVideo,
        quality_id: str,
    ) -> DownloadJob:
        if quality_id not in parsed_video.format_map:
            raise ServiceError("INVALID_URL", "清晰度选项无效，请重新解析。", 400)
        if self._stopping:
            raise ServiceError("QUEUE_FULL", "下载服务正在停止，请稍后重试。", 503, retryable=True)

        with self._lock:
            active_for_ip = sum(
                1
                for job in self._jobs.values()
                if job.client_ip == client_ip and job.status in ACTIVE_STATUSES
            )
            if active_for_ip >= self._settings.per_ip_active_downloads:
                raise ServiceError(
                    "RATE_LIMITED",
                    "当前客户端已有下载任务，请等待完成后重试。",
                    429,
                    retryable=True,
                )
            if self._queue.full():
                raise ServiceError(
                    "QUEUE_FULL",
                    "当前下载队列已满，请稍后重试。",
                    503,
                    retryable=True,
                )

            job_id, directory = self._files.create_job_directory()
            job = DownloadJob(
                id=job_id,
                session_digest=session_digest,
                client_ip=client_ip,
                parsed_video=parsed_video,
                quality_id=quality_id,
                directory=directory,
                created_at=self._clock(),
            )
            self._jobs[job_id] = job
            self._done_events[job_id] = asyncio.Event()
            try:
                self._queue.put_nowait(job_id)
            except asyncio.QueueFull as exc:
                self._jobs.pop(job_id, None)
                self._done_events.pop(job_id, None)
                self._files.cleanup(directory)
                raise ServiceError(
                    "QUEUE_FULL",
                    "当前下载队列已满，请稍后重试。",
                    503,
                    retryable=True,
                ) from exc
            return job

    def get(self, job_id: str, session_digest: str) -> DownloadJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.session_digest != session_digest:
                raise ServiceError("JOB_NOT_FOUND", "下载任务不存在或无权访问。", 404)
            if job.status is JobStatus.EXPIRED:
                raise ServiceError("JOB_EXPIRED", "下载任务和文件已过期。", 410)
            return job

    async def wait(self, job_id: str, timeout: float | None = None) -> DownloadJob:
        event = self._done_events.get(job_id)
        if event is None:
            raise ServiceError("JOB_NOT_FOUND", "下载任务不存在。", 404)
        if timeout is None:
            await event.wait()
        else:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        with self._lock:
            job = self._jobs[job_id]
            return job

    async def cancel(self, job_id: str, session_digest: str) -> DownloadJob:
        with self._lock:
            job = self.get(job_id, session_digest)
            if job.status in TERMINAL_STATUSES:
                return job
            job.cancel_event.set()
            if job.status is JobStatus.QUEUED:
                self._cancel_queued(job)
            return job

    def output_for(self, job_id: str, session_digest: str) -> Path:
        job = self.get(job_id, session_digest)
        if job.status is not JobStatus.COMPLETED or job.output_path is None:
            raise ServiceError("JOB_NOT_FOUND", "下载文件尚未生成或已不可用。", 404)
        output = job.output_path.resolve()
        if output.parent != job.directory.resolve() or not output.is_file():
            raise ServiceError("JOB_NOT_FOUND", "下载文件不存在。", 404)
        return output

    def cleanup_expired(self) -> int:
        now = self._clock()
        removed = 0
        with self._lock:
            for job in self._jobs.values():
                if (
                    job.status is JobStatus.COMPLETED
                    and job.completed_at is not None
                    and job.completed_at + self._settings.output_ttl_seconds <= now
                ):
                    self._files.cleanup(job.directory)
                    job.output_path = None
                    job.status = JobStatus.EXPIRED
                    removed += 1
        return removed

    async def _worker(self) -> None:
        while True:
            job_id = await self._queue.get()
            try:
                if job_id is None:
                    return
                with self._lock:
                    job = self._jobs.get(job_id)
                    if job is None or job.status is not JobStatus.QUEUED:
                        continue
                    job.status = JobStatus.EXTRACTING
                    job.progress = 1.0
                    job.started_at = self._clock()
                    selection = job.parsed_video.format_map[job.quality_id]
                    spec = DownloadSpec(
                        target=ResolvedVideoUrl(
                            platform=job.parsed_video.video.platform,
                            url=job.parsed_video.normalized_url,
                        ),
                        video_id=job.parsed_video.video.id,
                        title=job.parsed_video.video.title,
                        selection=selection,
                        directory=job.directory,
                        cancel_event=job.cancel_event,
                    )
                hooks = _JobProgressHooks(self, job)
                try:
                    output = await asyncio.to_thread(self._downloader.download, spec, hooks)
                except DownloadCancelled:
                    self._finish_cancelled(job)
                except ServiceError as exc:
                    self._finish_failed(job, exc)
                except Exception:
                    self._finish_failed(
                        job,
                        ServiceError(
                            "EXTRACTOR_TEMPORARILY_UNAVAILABLE",
                            "视频下载任务意外失败，请稍后重试。",
                            502,
                            retryable=True,
                        ),
                    )
                else:
                    if job.cancel_event.is_set():
                        self._finish_cancelled(job)
                    else:
                        self._finish_completed(job, output)
            finally:
                self._queue.task_done()

    def _finish_completed(self, job: DownloadJob, output: Path) -> None:
        try:
            resolved = output.resolve()
            if resolved.parent != job.directory.resolve() or not resolved.is_file():
                raise ServiceError(
                    "EXTRACTOR_TEMPORARILY_UNAVAILABLE",
                    "下载器返回了无效的输出文件。",
                    502,
                    retryable=True,
                )
            if resolved.stat().st_size > self._settings.max_file_bytes:
                raise ServiceError("FILE_SIZE_LIMIT", "视频文件超过当前服务限制。", 413)
        except ServiceError as exc:
            self._finish_failed(job, exc)
            return

        with self._lock:
            job.output_path = resolved
            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.completed_at = self._clock()
            self._done_events[job.id].set()

    def _finish_failed(self, job: DownloadJob, error: ServiceError) -> None:
        with self._lock:
            job.status = JobStatus.FAILED
            job.error = ErrorBody(
                code=error.code,
                message=error.message,
                retryable=error.retryable,
            )
            self._cleanup_job_files(job)
            self._done_events[job.id].set()

    def _finish_cancelled(self, job: DownloadJob) -> None:
        with self._lock:
            job.status = JobStatus.CANCELLED
            job.error = None
            self._cleanup_job_files(job)
            self._done_events[job.id].set()

    def _cancel_queued(self, job: DownloadJob) -> None:
        job.status = JobStatus.CANCELLED
        self._cleanup_job_files(job)
        self._done_events[job.id].set()

    def _cleanup_job_files(self, job: DownloadJob) -> None:
        self._files.cleanup(job.directory)
        job.output_path = None

    @staticmethod
    def _raise_if_cancelled(job: DownloadJob) -> None:
        if job.cancel_event.is_set():
            raise DownloadCancelled()

    async def _cleanup_loop(self) -> None:
        interval = min(30.0, max(1.0, self._settings.output_ttl_seconds / 2))
        while True:
            await asyncio.sleep(interval)
            self.cleanup_expired()
