from __future__ import annotations

import asyncio
import mimetypes
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import SecretStr

from .config import VideoSettings
from .dependencies import DependencyProbe
from .errors import ServiceError
from .extractor import ExtractedVideo, YtDlpExtractor
from .job_manager import DownloadJob, JobManager
from .models import (
    CreateDownloadRequest,
    CreateDownloadResponse,
    ErrorBody,
    ErrorEnvelope,
    HealthCapabilities,
    HealthResponse,
    JobStatusResponse,
    ParseRequest,
    ParseResponse,
)
from .rate_limit import ClientIpResolver, SlidingWindowRateLimiter
from .security import AnonymousSession, ParseRecordStore, SessionService, TokenService
from .url_policy import UrlPolicy


def _error_response(exc: ServiceError) -> JSONResponse:
    payload = ErrorEnvelope(
        error=ErrorBody(
            code=exc.code,
            message=exc.message,
            retryable=exc.retryable,
        )
    )
    headers = {"Cache-Control": "no-store"}
    if exc.retry_after_seconds is not None:
        headers["Retry-After"] = str(exc.retry_after_seconds)
    return JSONResponse(
        status_code=exc.http_status,
        content=payload.model_dump(mode="json", by_alias=True),
        headers=headers,
    )


def _job_response(job: DownloadJob) -> JobStatusResponse:
    return JobStatusResponse(
        job_id=job.id,
        status=job.status.value,
        stage=job.status.value,
        progress=round(job.progress, 2),
        downloaded_bytes=job.downloaded_bytes,
        total_bytes=job.total_bytes,
        speed_bytes_per_second=job.speed_bytes_per_second,
        error=job.error,
    )


def create_app(
    settings: VideoSettings | None = None,
    dependency_probe: Any | None = None,
    url_policy: Any | None = None,
    extractor: Any | None = None,
    rate_limiter: SlidingWindowRateLimiter | None = None,
    session_service: SessionService | None = None,
    parse_store: ParseRecordStore | None = None,
    token_service: TokenService | None = None,
    job_manager: JobManager | None = None,
) -> FastAPI:
    resolved_settings = settings or VideoSettings()
    if resolved_settings.signing_secret is None:
        resolved_settings.signing_secret = SecretStr(secrets.token_urlsafe(48))
    signing_secret = resolved_settings.signing_secret.get_secret_value()

    probe = dependency_probe or DependencyProbe(resolved_settings)
    resolver = url_policy or UrlPolicy.from_settings(resolved_settings)
    video_extractor = extractor or YtDlpExtractor(resolved_settings)
    limiter = rate_limiter or SlidingWindowRateLimiter(resolved_settings)
    sessions = session_service or SessionService(resolved_settings.session_ttl_seconds)
    records = parse_store or ParseRecordStore(resolved_settings.parse_token_ttl_seconds)
    tokens = token_service or TokenService(
        signing_secret,
        resolved_settings.parse_token_ttl_seconds,
    )
    jobs = job_manager or JobManager(resolved_settings, video_extractor)
    client_ips = ClientIpResolver(resolved_settings.trusted_proxy_networks)

    async def cleanup_ephemeral_state() -> None:
        interval = min(
            30.0,
            max(
                1.0,
                min(
                    resolved_settings.session_ttl_seconds,
                    resolved_settings.parse_token_ttl_seconds,
                )
                / 2,
            ),
        )
        while True:
            await asyncio.sleep(interval)
            sessions.cleanup_expired()
            records.cleanup_expired()

    @asynccontextmanager
    async def lifespan(_application: FastAPI):
        await jobs.start()
        state_cleanup = asyncio.create_task(
            cleanup_ephemeral_state(),
            name="video-session-cleanup",
        )
        try:
            yield
        finally:
            state_cleanup.cancel()
            await asyncio.gather(state_cleanup, return_exceptions=True)
            await jobs.stop()

    application = FastAPI(
        title="SD Video Downloader",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.settings = resolved_settings
    application.state.dependency_probe = probe
    application.state.url_policy = resolver
    application.state.extractor = video_extractor
    application.state.job_manager = jobs

    @application.middleware("http")
    async def disable_cache(request: Request, call_next):
        response = await call_next(request)
        if "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.exception_handler(ServiceError)
    async def handle_service_error(_request: Request, exc: ServiceError) -> JSONResponse:
        return _error_response(exc)

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request,
        _exc: RequestValidationError,
    ) -> JSONResponse:
        return _error_response(
            ServiceError(
                "INVALID_URL",
                "请求参数格式不正确。",
                400,
            )
        )

    def client_ip(request: Request) -> str:
        peer = request.client.host if request.client else None
        return client_ips.resolve(peer, request.headers.get("x-forwarded-for"))

    def optional_session(request: Request) -> AnonymousSession | None:
        return sessions.resolve(request.cookies.get(resolved_settings.cookie_name))

    def required_session(request: Request) -> AnonymousSession:
        session = optional_session(request)
        if session is None:
            raise ServiceError("JOB_NOT_FOUND", "匿名服务会话不存在或已过期。", 404)
        return session

    @application.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        dependency_status = probe.status()
        service_status = "ok" if dependency_status.yt_dlp and dependency_status.ffmpeg else "degraded"
        return HealthResponse(
            status=service_status,
            capabilities=HealthCapabilities(
                yt_dlp=dependency_status.yt_dlp,
                ffmpeg=dependency_status.ffmpeg,
                douyin_cookie=dependency_status.douyin_cookie,
            ),
        )

    @application.post("/api/v1/parse", response_model=ParseResponse)
    async def parse_video(
        payload: ParseRequest,
        request: Request,
        response: Response,
    ) -> ParseResponse:
        dependency_status = probe.status()
        if not dependency_status.yt_dlp:
            raise ServiceError(
                "DEPENDENCY_UNAVAILABLE",
                "视频解析依赖暂不可用，请稍后重试。",
                503,
                retryable=True,
            )
        limiter.consume(client_ip(request), "parse")
        target = await asyncio.to_thread(resolver.resolve, payload.url)
        parsed = await asyncio.to_thread(video_extractor.extract, target)

        session = optional_session(request)
        if session is None:
            session = sessions.create()
            response.set_cookie(
                key=resolved_settings.cookie_name,
                value=session.value,
                max_age=resolved_settings.session_ttl_seconds,
                path=resolved_settings.cookie_path,
                secure=resolved_settings.cookie_secure,
                httponly=True,
                samesite="strict",
            )
        record = records.put(session.digest, parsed)
        parse_token = tokens.issue(record.id, session.digest)
        return ParseResponse(
            parse_token=parse_token,
            expires_at=datetime.fromtimestamp(record.expires_at, tz=timezone.utc),
            video=parsed.video,
        )

    @application.post(
        "/api/v1/downloads",
        response_model=CreateDownloadResponse,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def create_download(
        payload: CreateDownloadRequest,
        request: Request,
    ) -> CreateDownloadResponse:
        session = required_session(request)
        limiter.consume(client_ip(request), "download")
        claims = tokens.verify(payload.parse_token, session.digest)
        record = records.get(claims.record_id, session.digest)
        if not isinstance(record.payload, ExtractedVideo):
            raise ServiceError("JOB_NOT_FOUND", "解析记录无效。", 404)
        selection = record.payload.format_map.get(payload.quality_id)
        if selection is None:
            raise ServiceError("INVALID_URL", "清晰度选项无效，请重新解析。", 400)
        if selection.public.requires_merge and not probe.status().ffmpeg:
            raise ServiceError(
                "DEPENDENCY_UNAVAILABLE",
                "该清晰度需要 FFmpeg 合并音视频，但服务器当前不可用。",
                503,
                retryable=True,
            )
        job = await jobs.enqueue(
            session_digest=session.digest,
            client_ip=client_ip(request),
            parsed_video=record.payload,
            quality_id=payload.quality_id,
        )
        return CreateDownloadResponse(job_id=job.id, status="queued")

    @application.get(
        "/api/v1/downloads/{job_id}",
        response_model=JobStatusResponse,
    )
    async def get_download(job_id: str, request: Request) -> JobStatusResponse:
        session = required_session(request)
        return _job_response(jobs.get(job_id, session.digest))

    @application.delete(
        "/api/v1/downloads/{job_id}",
        response_model=JobStatusResponse,
    )
    async def cancel_download(job_id: str, request: Request) -> JobStatusResponse:
        session = required_session(request)
        job = await jobs.cancel(job_id, session.digest)
        return _job_response(job)

    @application.get("/api/v1/downloads/{job_id}/file")
    async def download_file(job_id: str, request: Request) -> FileResponse:
        session = required_session(request)
        output = jobs.output_for(job_id, session.digest)
        media_type = mimetypes.guess_type(output.name)[0] or "application/octet-stream"
        return FileResponse(
            path=output,
            filename=output.name,
            media_type=media_type,
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    return application


app = create_app()
