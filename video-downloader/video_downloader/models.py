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
