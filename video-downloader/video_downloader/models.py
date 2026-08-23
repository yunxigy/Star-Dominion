from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class ErrorBody(ApiModel):
    code: str
    message: str
    retryable: bool


class ErrorEnvelope(ApiModel):
    error: ErrorBody


class HealthCapabilities(ApiModel):
    yt_dlp: bool
    ffmpeg: bool
    douyin_cookie: Literal["configured", "missing", "invalid"]


class HealthResponse(ApiModel):
    status: Literal["ok", "degraded"]
    capabilities: HealthCapabilities


class QualityOption(ApiModel):
    id: str
    label: str
    height: int
    extension: str
    estimated_bytes: int | None
    requires_merge: bool
    has_audio: bool


class VideoInfo(ApiModel):
    platform: Literal["douyin", "bilibili"]
    id: str
    title: str
    author: str | None
    thumbnail_url: str | None
    duration_seconds: int
    qualities: list[QualityOption]
