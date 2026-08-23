from __future__ import annotations

import secrets

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import SecretStr

from .config import VideoSettings
from .dependencies import DependencyProbe
from .errors import ServiceError
from .models import ErrorBody, ErrorEnvelope, HealthCapabilities, HealthResponse


def create_app(
    settings: VideoSettings | None = None,
    dependency_probe: DependencyProbe | None = None,
) -> FastAPI:
    resolved_settings = settings or VideoSettings()
    if resolved_settings.signing_secret is None:
        resolved_settings.signing_secret = SecretStr(secrets.token_urlsafe(48))
    probe = dependency_probe or DependencyProbe(resolved_settings)

    application = FastAPI(title="SD Video Downloader", version="0.1.0")
    application.state.settings = resolved_settings
    application.state.dependency_probe = probe

    @application.exception_handler(ServiceError)
    async def handle_service_error(_request: Request, exc: ServiceError) -> JSONResponse:
        payload = ErrorEnvelope(
            error=ErrorBody(
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
            )
        )
        return JSONResponse(
            status_code=exc.http_status,
            content=payload.model_dump(mode="json", by_alias=True),
        )

    @application.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        status = probe.status()
        service_status = "ok" if status.yt_dlp and status.ffmpeg else "degraded"
        return HealthResponse(
            status=service_status,
            capabilities=HealthCapabilities(
                yt_dlp=status.yt_dlp,
                ffmpeg=status.ffmpeg,
                douyin_cookie=status.douyin_cookie,
            ),
        )

    return application


app = create_app()
