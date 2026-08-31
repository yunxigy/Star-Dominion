"""Persistent manifest for one chapter generation/review run."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ChapterRunStage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["pending", "running", "completed", "failed"] = "pending"
    started_at: str = ""
    completed_at: str = ""
    usage: dict[str, Any] = Field(default_factory=dict)
    error_code: str = ""


class ChapterRunManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    run_id: str
    novel_id: str
    chapter_id: str
    status: Literal["running", "written", "reviewed", "failed"] = "running"
    created_at: str
    updated_at: str
    requested_target_words: int = 0
    outline_target_words: int = 0
    effective_target_words: int = 0
    provider: str = ""
    model: str = ""
    routes: dict[str, str] = Field(default_factory=dict)
    context_revision: str = ""
    baseline_state_revision: int = 0
    prompt_versions: dict[str, str] = Field(default_factory=dict)
    draft_revision: str = ""
    review_revision: str = ""
    stages: dict[str, ChapterRunStage] = Field(default_factory=dict)
