from __future__ import annotations

import asyncio
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from video_downloader.app import create_app
from video_downloader.dependencies import DependencyStatus
from video_downloader.extractor import DownloadCancelled, ExtractedVideo
from video_downloader.format_policy import FormatSelection
from video_downloader.job_manager import JobManager
from video_downloader.models import QualityOption, VideoInfo
from video_downloader.security import ParseRecordStore, SessionService, TokenService
from video_downloader.url_policy import ResolvedVideoUrl


class FakeDependencyProbe:
    def __init__(self, *, yt_dlp: bool = True, ffmpeg: bool = True) -> None:
        self._status = DependencyStatus(
            yt_dlp=yt_dlp,
            ffmpeg=ffmpeg,
            douyin_cookie="missing",
        )

    def status(self) -> DependencyStatus:
        return self._status


class FakeUrlPolicy:
    def __init__(self, platform: str = "bilibili") -> None:
        self.platform = platform
        self.inputs: list[str] = []

    def resolve(self, text: str) -> ResolvedVideoUrl:
        self.inputs.append(text)
        if self.platform == "douyin":
            return ResolvedVideoUrl("douyin", "https://www.douyin.com/video/123")
        return ResolvedVideoUrl("bilibili", "https://www.bilibili.com/video/BV1demo")


def extracted_video() -> ExtractedVideo:
    quality = QualityOption(
        id="q_12345678",
        label="720P",
        height=720,
        extension="mp4",
        estimated_bytes=None,
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
            thumbnail_url="https://i0.hdslb.com/demo.jpg",
            duration_seconds=10,
            qualities=[quality],
        ),
        format_map={
            quality.id: FormatSelection(
                public=quality,
                selector="p720",
                merge_extension=None,
            )
        },
    )


class FakeExtractor:
    def __init__(self) -> None:
        self.targets: list[ResolvedVideoUrl] = []

    def extract(self, target: ResolvedVideoUrl) -> ExtractedVideo:
        self.targets.append(target)
        return extracted_video()


class ImmediateDownloader:
    def download(self, spec, hooks):
        hooks.extracting()
        hooks.downloading(100, 100, 25.0)
        output = spec.directory / "演示视频-bilibili-BV1demo.mp4"
        output.write_bytes(b"video-bytes")
        hooks.completed(output)
        return output


class BlockingDownloader:
    def __init__(self) -> None:
        self.started = threading.Event()

    def download(self, spec, hooks):
        hooks.downloading(1, 100, None)
        self.started.set()
        while not spec.cancel_event.wait(0.01):
            continue
        raise DownloadCancelled()


def build_test_app(
    settings,
    *,
    downloader=None,
    probe=None,
    token_service=None,
    parse_store=None,
    session_service=None,
):
    extractor = FakeExtractor()
    manager = JobManager(settings, downloader or ImmediateDownloader())
    app = create_app(
        settings=settings,
        dependency_probe=probe or FakeDependencyProbe(),
        url_policy=FakeUrlPolicy(),
        extractor=extractor,
        session_service=session_service or SessionService(settings.session_ttl_seconds),
        parse_store=parse_store or ParseRecordStore(settings.parse_token_ttl_seconds),
        token_service=token_service,
        job_manager=manager,
    )
    return app, extractor, manager


class RecordingSessionService(SessionService):
    def __init__(self, ttl_seconds: int) -> None:
        super().__init__(ttl_seconds)
        self.cleaned = threading.Event()

    def cleanup_expired(self) -> int:
        self.cleaned.set()
        return super().cleanup_expired()


class RecordingParseStore(ParseRecordStore):
    def __init__(self, ttl_seconds: int) -> None:
        super().__init__(ttl_seconds)
        self.cleaned = threading.Event()

    def cleanup_expired(self) -> int:
        self.cleaned.set()
        return super().cleanup_expired()


@asynccontextmanager
async def running_client(app):
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app, client=("127.0.0.1", 12345))
        async with AsyncClient(
            transport=transport,
            base_url="https://testserver",
        ) as client:
            yield client


def session_cookie(response) -> str:
    value = response.cookies.get("sd_video_session")
    assert value
    return f"sd_video_session={value}"


async def parse_once(client):
    return await client.post(
        "/api/v1/parse",
        json={"url": "https://b23.tv/demo"},
    )


@pytest.mark.asyncio
async def test_parse_sets_private_session_and_returns_no_media_urls(settings):
    app, extractor, _manager = build_test_app(settings)
    async with running_client(app) as client:
        response = await parse_once(client)

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"parseToken", "expiresAt", "video"}
    assert payload["video"]["platform"] == "bilibili"
    assert payload["video"]["qualities"][0]["id"] == "q_12345678"
    assert "format_id" not in response.text
    assert "mediaUrl" not in response.text
    assert "p720" not in response.text
    assert len(extractor.targets) == 1

    cookie = response.headers["set-cookie"]
    assert "sd_video_session=" in cookie
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=strict" in cookie
    assert "Path=/video-api/" in cookie
    assert "Max-Age=3600" in cookie
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_existing_session_is_reused_without_rotating_cookie(settings):
    app, _extractor, _manager = build_test_app(settings)
    async with running_client(app) as client:
        first = await parse_once(client)
        second = await client.post(
            "/api/v1/parse",
            json={"url": "https://b23.tv/second"},
            headers={"Cookie": session_cookie(first)},
        )

    assert second.status_code == 200
    assert "set-cookie" not in second.headers


@pytest.mark.asyncio
async def test_validation_errors_use_stable_envelope(settings):
    app, _extractor, _manager = build_test_app(settings)
    async with running_client(app) as client:
        response = await client.post("/api/v1/parse", json={"url": ""})

    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "INVALID_URL",
            "message": "请求参数格式不正确。",
            "retryable": False,
        }
    }


@pytest.mark.asyncio
async def test_parse_is_disabled_when_yt_dlp_is_missing(settings):
    app, _extractor, _manager = build_test_app(
        settings,
        probe=FakeDependencyProbe(yt_dlp=False, ffmpeg=True),
    )
    async with running_client(app) as client:
        response = await parse_once(client)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DEPENDENCY_UNAVAILABLE"


@pytest.mark.asyncio
async def test_parse_download_status_and_file_flow(settings):
    app, _extractor, _manager = build_test_app(settings)
    async with running_client(app) as client:
        parsed = await parse_once(client)
        cookie = session_cookie(parsed)
        created = await client.post(
            "/api/v1/downloads",
            json={
                "parseToken": parsed.json()["parseToken"],
                "qualityId": "q_12345678",
            },
            headers={"Cookie": cookie},
        )
        assert created.status_code == 202
        job_id = created.json()["jobId"]

        for _ in range(100):
            status = await client.get(
                f"/api/v1/downloads/{job_id}",
                headers={"Cookie": cookie},
            )
            if status.json()["status"] == "completed":
                break
            await asyncio.sleep(0.01)

        file_response = await client.get(
            f"/api/v1/downloads/{job_id}/file",
            headers={"Cookie": cookie},
        )

    assert status.status_code == 200
    assert status.json() == {
        "jobId": job_id,
        "status": "completed",
        "stage": "completed",
        "progress": 100.0,
        "downloadedBytes": 100,
        "totalBytes": 100,
        "speedBytesPerSecond": 25.0,
        "error": None,
    }
    assert file_response.status_code == 200
    assert file_response.content == b"video-bytes"
    assert file_response.headers["content-disposition"].startswith("attachment")
    assert file_response.headers["x-content-type-options"] == "nosniff"
    assert file_response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_cross_session_cannot_query_or_download_job(settings):
    app, _extractor, _manager = build_test_app(settings)
    async with running_client(app) as client:
        first_parse = await parse_once(client)
        first_cookie = session_cookie(first_parse)
        created = await client.post(
            "/api/v1/downloads",
            json={"parseToken": first_parse.json()["parseToken"], "qualityId": "q_12345678"},
            headers={"Cookie": first_cookie},
        )
        second_parse = await parse_once(client)
        second_cookie = session_cookie(second_parse)
        job_id = created.json()["jobId"]

        status = await client.get(
            f"/api/v1/downloads/{job_id}",
            headers={"Cookie": second_cookie},
        )
        file_response = await client.get(
            f"/api/v1/downloads/{job_id}/file",
            headers={"Cookie": second_cookie},
        )

    assert status.status_code == 404
    assert status.json()["error"]["code"] == "JOB_NOT_FOUND"
    assert file_response.status_code == 404


@pytest.mark.asyncio
async def test_tampered_quality_is_rejected(settings):
    app, _extractor, _manager = build_test_app(settings)
    async with running_client(app) as client:
        parsed = await parse_once(client)
        response = await client.post(
            "/api/v1/downloads",
            json={"parseToken": parsed.json()["parseToken"], "qualityId": "q_tampered"},
            headers={"Cookie": session_cookie(parsed)},
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_URL"


@pytest.mark.asyncio
async def test_expired_parse_token_returns_job_expired(settings):
    now = [100.0]
    token_service = TokenService(
        settings.signing_secret.get_secret_value(),
        settings.parse_token_ttl_seconds,
        clock=lambda: now[0],
    )
    parse_store = ParseRecordStore(settings.parse_token_ttl_seconds, clock=lambda: now[0])
    app, _extractor, _manager = build_test_app(
        settings,
        token_service=token_service,
        parse_store=parse_store,
    )
    async with running_client(app) as client:
        parsed = await parse_once(client)
        now[0] += settings.parse_token_ttl_seconds + 1
        response = await client.post(
            "/api/v1/downloads",
            json={"parseToken": parsed.json()["parseToken"], "qualityId": "q_12345678"},
            headers={"Cookie": session_cookie(parsed)},
        )

    assert response.status_code == 410
    assert response.json()["error"]["code"] == "JOB_EXPIRED"


@pytest.mark.asyncio
async def test_cancel_endpoint_is_idempotent(settings):
    downloader = BlockingDownloader()
    app, _extractor, _manager = build_test_app(settings, downloader=downloader)
    async with running_client(app) as client:
        parsed = await parse_once(client)
        cookie = session_cookie(parsed)
        created = await client.post(
            "/api/v1/downloads",
            json={"parseToken": parsed.json()["parseToken"], "qualityId": "q_12345678"},
            headers={"Cookie": cookie},
        )
        for _ in range(100):
            if downloader.started.is_set():
                break
            await asyncio.sleep(0.01)
        job_id = created.json()["jobId"]

        first = await client.delete(
            f"/api/v1/downloads/{job_id}",
            headers={"Cookie": cookie},
        )
        for _ in range(100):
            status = await client.get(
                f"/api/v1/downloads/{job_id}",
                headers={"Cookie": cookie},
            )
            if status.json()["status"] == "cancelled":
                break
            await asyncio.sleep(0.01)
        second = await client.delete(
            f"/api/v1/downloads/{job_id}",
            headers={"Cookie": cookie},
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_lifespan_periodically_cleans_sessions_and_parse_records(settings):
    configured = settings.model_copy(
        update={"session_ttl_seconds": 1, "parse_token_ttl_seconds": 1}
    )
    sessions = RecordingSessionService(configured.session_ttl_seconds)
    records = RecordingParseStore(configured.parse_token_ttl_seconds)
    app, _extractor, _manager = build_test_app(
        configured,
        session_service=sessions,
        parse_store=records,
    )

    async with running_client(app):
        for _ in range(150):
            if sessions.cleaned.is_set() and records.cleaned.is_set():
                break
            await asyncio.sleep(0.01)

    assert sessions.cleaned.is_set()
    assert records.cleaned.is_set()
