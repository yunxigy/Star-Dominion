from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

import pytest

from video_downloader.errors import ServiceError
from video_downloader.extractor import DownloadCancelled, ExtractedVideo
from video_downloader.format_policy import FormatSelection
from video_downloader.job_manager import JobManager, JobStatus
from video_downloader.models import QualityOption, VideoInfo


def parsed_video(*, quality_id: str = "q_12345678") -> ExtractedVideo:
    quality = QualityOption(
        id=quality_id,
        label="720P",
        height=720,
        extension="mp4",
        estimated_bytes=100,
        requires_merge=False,
        has_audio=True,
    )
    return ExtractedVideo(
        normalized_url="https://www.bilibili.com/video/BV1demo",
        video=VideoInfo(
            platform="bilibili",
            id="BV1demo",
            title="演示视频",
            author="作者",
            thumbnail_url=None,
            duration_seconds=10,
            qualities=[quality],
        ),
        format_map={
            quality_id: FormatSelection(
                public=quality,
                selector="p720",
                merge_extension=None,
            )
        },
    )


class ControlledDownloader:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self.active = 0
        self.maximum_active = 0
        self._lock = threading.Lock()

    def download(self, spec, hooks):
        with self._lock:
            self.active += 1
            self.maximum_active = max(self.maximum_active, self.active)
        try:
            hooks.extracting()
            hooks.downloading(50, 100, 10.0)
            self.started.set()
            while not self.release.wait(0.01):
                if spec.cancel_event.is_set():
                    raise DownloadCancelled()
            if spec.cancel_event.is_set():
                raise DownloadCancelled()
            output = spec.directory / "media.mp4"
            output.write_bytes(b"video")
            hooks.completed(output)
            return output
        finally:
            with self._lock:
                self.active -= 1


async def wait_for(predicate, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("condition was not met before timeout")
        await asyncio.sleep(0.01)


@pytest.mark.asyncio
async def test_job_moves_through_queue_and_completes(settings):
    downloader = ControlledDownloader()
    manager = JobManager(settings, downloader)
    await manager.start()
    try:
        job = await manager.enqueue(
            session_digest="session-a",
            client_ip="203.0.113.10",
            parsed_video=parsed_video(),
            quality_id="q_12345678",
        )
        await wait_for(lambda: downloader.started.is_set())
        running = manager.get(job.id, "session-a")
        assert running.status is JobStatus.DOWNLOADING
        assert running.progress == 47.5
        assert running.downloaded_bytes == 50
        assert running.total_bytes == 100
        assert running.speed_bytes_per_second == 10.0

        downloader.release.set()
        completed = await manager.wait(job.id, timeout=2)

        assert completed.status is JobStatus.COMPLETED
        assert completed.progress == 100
        assert completed.output_path is not None
        assert completed.output_path.is_file()
    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_global_worker_count_caps_concurrency(settings):
    configured = settings.model_copy(update={"global_download_concurrency": 2})
    downloader = ControlledDownloader()
    manager = JobManager(configured, downloader)
    await manager.start()
    try:
        await manager.enqueue("s1", "203.0.113.1", parsed_video(), "q_12345678")
        await manager.enqueue("s2", "203.0.113.2", parsed_video(), "q_12345678")
        await manager.enqueue("s3", "203.0.113.3", parsed_video(), "q_12345678")
        await wait_for(lambda: downloader.maximum_active == 2)

        assert downloader.maximum_active == 2
    finally:
        downloader.release.set()
        await manager.stop()


@pytest.mark.asyncio
async def test_rejects_second_active_job_for_the_same_ip(settings):
    manager = JobManager(settings, ControlledDownloader())
    await manager.enqueue("s1", "203.0.113.10", parsed_video(), "q_12345678")

    with pytest.raises(ServiceError) as caught:
        await manager.enqueue("s2", "203.0.113.10", parsed_video(), "q_12345678")

    assert caught.value.code == "RATE_LIMITED"
    await manager.stop()


@pytest.mark.asyncio
async def test_rejects_when_waiting_queue_is_full(settings):
    configured = settings.model_copy(update={"global_download_concurrency": 1, "max_queue_size": 2})
    downloader = ControlledDownloader()
    manager = JobManager(configured, downloader)
    await manager.start()
    try:
        await manager.enqueue("s0", "203.0.113.0", parsed_video(), "q_12345678")
        await wait_for(lambda: downloader.started.is_set())
        await manager.enqueue("s1", "203.0.113.1", parsed_video(), "q_12345678")
        await manager.enqueue("s2", "203.0.113.2", parsed_video(), "q_12345678")

        with pytest.raises(ServiceError) as caught:
            await manager.enqueue("s3", "203.0.113.3", parsed_video(), "q_12345678")

        assert caught.value.code == "QUEUE_FULL"
    finally:
        downloader.release.set()
        await manager.stop()


@pytest.mark.asyncio
async def test_queued_cancel_is_idempotent_and_cleans_files(settings):
    manager = JobManager(settings, ControlledDownloader())
    job = await manager.enqueue("session-a", "203.0.113.1", parsed_video(), "q_12345678")
    assert job.directory.exists()

    first = await manager.cancel(job.id, "session-a")
    second = await manager.cancel(job.id, "session-a")

    assert first.status is JobStatus.CANCELLED
    assert second.status is JobStatus.CANCELLED
    assert not job.directory.exists()
    await manager.stop()


@pytest.mark.asyncio
async def test_running_cancel_stops_worker_and_cleans_files(settings):
    downloader = ControlledDownloader()
    manager = JobManager(settings, downloader)
    await manager.start()
    try:
        job = await manager.enqueue("session-a", "203.0.113.1", parsed_video(), "q_12345678")
        await wait_for(lambda: downloader.started.is_set())

        await manager.cancel(job.id, "session-a")
        cancelled = await manager.wait(job.id, timeout=2)

        assert cancelled.status is JobStatus.CANCELLED
        assert not job.directory.exists()
    finally:
        downloader.release.set()
        await manager.stop()


class OversizeDownloader:
    def download(self, spec, hooks):
        hooks.downloading(101, 200, None)
        raise AssertionError("size guard should have interrupted the downloader")


@pytest.mark.asyncio
async def test_actual_bytes_over_limit_fail_and_cleanup(settings):
    configured = settings.model_copy(update={"max_file_bytes": 100})
    manager = JobManager(configured, OversizeDownloader())
    await manager.start()
    try:
        job = await manager.enqueue("session-a", "203.0.113.1", parsed_video(), "q_12345678")
        failed = await manager.wait(job.id, timeout=2)

        assert failed.status is JobStatus.FAILED
        assert failed.error is not None
        assert failed.error.code == "FILE_SIZE_LIMIT"
        assert not job.directory.exists()
    finally:
        await manager.stop()


class FailingDownloader:
    def download(self, spec, hooks):
        (spec.directory / "partial.part").write_bytes(b"partial")
        raise ServiceError("MERGE_FAILED", "合并失败", 500)


@pytest.mark.asyncio
async def test_downloader_failure_is_stable_and_cleans_fragments(settings):
    manager = JobManager(settings, FailingDownloader())
    await manager.start()
    try:
        job = await manager.enqueue("session-a", "203.0.113.1", parsed_video(), "q_12345678")
        failed = await manager.wait(job.id, timeout=2)

        assert failed.status is JobStatus.FAILED
        assert failed.error is not None
        assert failed.error.code == "MERGE_FAILED"
        assert not job.directory.exists()
    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_completed_file_expires_and_preserves_ownership_boundary(settings):
    now = [100.0]
    downloader = ControlledDownloader()
    downloader.release.set()
    manager = JobManager(settings, downloader, clock=lambda: now[0])
    await manager.start()
    try:
        job = await manager.enqueue("session-a", "203.0.113.1", parsed_video(), "q_12345678")
        await manager.wait(job.id, timeout=2)
        now[0] += settings.output_ttl_seconds + 1

        assert manager.cleanup_expired() == 1
        with pytest.raises(ServiceError) as expired:
            manager.get(job.id, "session-a")
        assert expired.value.code == "JOB_EXPIRED"
        with pytest.raises(ServiceError) as hidden:
            manager.get(job.id, "session-b")
        assert hidden.value.code == "JOB_NOT_FOUND"
        assert not job.directory.exists()
    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_invalid_quality_id_is_rejected_before_directory_creation(settings):
    manager = JobManager(settings, ControlledDownloader())

    with pytest.raises(ServiceError) as caught:
        await manager.enqueue("session-a", "203.0.113.1", parsed_video(), "q_tampered")

    assert caught.value.code == "INVALID_URL"
    assert not settings.temp_dir.exists() or not any(settings.temp_dir.iterdir())
    await manager.stop()
