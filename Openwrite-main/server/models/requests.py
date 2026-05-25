"""Request Pydantic schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class NovelConfigUpdate(BaseModel):
    novel_id: str | None = None
    style_id: str | None = None
    current_arc: str | None = None
    current_chapter: str | None = None
    default_word_count: int | None = None
    max_tokens: int | None = None


class WriteChapterRequest(BaseModel):
    guidance: str | None = None
    temperature: float | None = None
    no_review: bool = False


class ReviewChapterRequest(BaseModel):
    pass


class CreateCharacterRequest(BaseModel):
    name: str
    tier: str | None = None
    summary: str | None = None
    content: str | None = None


class UpdateCharacterRequest(BaseModel):
    content: str


class CreateForeshadowingRequest(BaseModel):
    content: str
    weight: int = 5
    layer: str = "主线"
    target_arc: str | None = None
    target_section: str | None = None
    target_chapter: str | None = None


class UpdateForeshadowingRequest(BaseModel):
    content: str | None = None
    weight: int | None = None
    layer: str | None = None
    status: str | None = None


class UpdateTruthFileRequest(BaseModel):
    content: str


class CreateOutlineRequest(BaseModel):
    content: str


class StyleExtractRequest(BaseModel):
    source_name: str
    source_text: str | None = None
    source_path: str | None = None


class StyleSynthesizeRequest(BaseModel):
    pass


class AgentMessageRequest(BaseModel):
    message: str
