"""Validated requests and persistent state for individual-stock analysis."""

from datetime import datetime
import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.domain.model_profiles import ModelProfileScope
from app.domain.stocks import normalize_symbol


AnalysisState = Literal[
    "queued", "collecting", "analyzing", "rendering", "succeeded", "failed"
]
ReportType = Literal["detailed", "brief"]


class AnalysisCreate(BaseModel):
    symbol: str
    profile_id: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=300)
    report_type: ReportType = "detailed"
    force_refresh: bool = False

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, value: str) -> str:
        return normalize_symbol(value)

    @field_validator("profile_id", "model")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("value cannot be blank")
        return stripped


class AnalysisTask(BaseModel):
    task_id: str
    owner_id: str
    symbol: str
    profile_id: str
    profile_name: str
    profile_scope: ModelProfileScope
    model: str
    report_type: ReportType
    force_refresh: bool
    state: AnalysisState
    progress_message: str
    cache_hit: bool = False
    error_code: str | None = None
    error_message: str | None = None
    report: dict | None = None
    upstream_query_id: str | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class AnalysisTaskPublic(BaseModel):
    task_id: str
    symbol: str
    profile_id: str
    profile_name: str
    profile_scope: ModelProfileScope
    model: str
    report_type: ReportType
    force_refresh: bool
    state: AnalysisState
    progress_message: str
    cache_hit: bool
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    @classmethod
    def from_task(cls, task: AnalysisTask) -> "AnalysisTaskPublic":
        return cls.model_validate(task.model_dump(exclude={"owner_id", "report", "upstream_query_id"}))


class AnalysisReportPublic(BaseModel):
    task_id: str
    report: dict


def cache_key(*, owner: str, symbol: str, profile: str, model: str, report: str) -> str:
    value = json.dumps(
        [owner, normalize_symbol(symbol), profile, model, report],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
