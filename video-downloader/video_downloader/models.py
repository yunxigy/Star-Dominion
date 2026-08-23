from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
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


class ParseRequest(ApiModel):
    url: str = Field(min_length=1, max_length=4096)


class ParseResponse(ApiModel):
    parse_token: str
    expires_at: datetime
    video: VideoInfo


class CreateDownloadRequest(ApiModel):
    parse_token: str = Field(min_length=16, max_length=4096)
    quality_id: str = Field(pattern=r"^q_[a-zA-Z0-9_-]{8,32}$")


class CreateDownloadResponse(ApiModel):
    job_id: str
    status: Literal["queued"]


JobStatusValue = Literal[
    "queued",
    "extracting",
    "downloading",
    "merging",
    "completed",
    "failed",
    "cancelled",
    "expired",
]


class JobStatusResponse(ApiModel):
    job_id: str
    status: JobStatusValue
    stage: JobStatusValue
    progress: float
    downloaded_bytes: int
    total_bytes: int | None
    speed_bytes_per_second: float | None
    error: ErrorBody | None
