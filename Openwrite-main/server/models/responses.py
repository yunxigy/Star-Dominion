"""Response Pydantic schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None


class NovelInfo(BaseModel):
    novel_id: str
    path: str
    has_outline: bool = False
    has_characters: bool = False
    chapter_count: int = 0


class NovelConfigResponse(BaseModel):
    novel_id: str
    style_id: str | None = None
    current_arc: str | None = None
    current_chapter: str | None = None
    default_word_count: int | None = None
    max_tokens: int | None = None


class StatusResponse(BaseModel):
    novel_id: str
    current_arc: str | None = None
    current_chapter: str | None = None
    chapters_written: int = 0
    snapshots: list[str] = []
    book_stage: str | None = None


class ChapterInfo(BaseModel):
    number: int
    chapter_id: str
    title: str | None = None


class ChapterListResponse(BaseModel):
    chapters: list[ChapterInfo]


class ChapterContentResponse(BaseModel):
    chapter_id: str
    title: str | None = None
    content: str
    word_count: int


class WriteChapterResponse(BaseModel):
    ok: bool
    chapter_id: str
    title: str | None = None
    word_count: int = 0
    draft_path: str | None = None
    truth_updates: dict[str, Any] = {}


class ReviewChapterResponse(BaseModel):
    ok: bool
    chapter_id: str
    passed: bool = False
    score: float | None = None
    issues: list[dict[str, Any]] = []


class OutlineResponse(BaseModel):
    content: str
    hierarchy: dict[str, Any] | None = None


class CharacterListResponse(BaseModel):
    characters: list[dict[str, Any]]


class CharacterDetailResponse(BaseModel):
    name: str
    content: str
    tier: str | None = None
    summary: str | None = None


class TruthFilesResponse(BaseModel):
    current_state: str = ""
    ledger: str = ""
    relationships: str = ""


class ForeshadowingListResponse(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class WorkflowStatusResponse(BaseModel):
    novel_id: str
    stage: str | None = None
    chapters: list[dict[str, Any]] = []


class SyncResponse(BaseModel):
    ok: bool
    message: str
    details: dict[str, Any] = {}


class TaskCreatedResponse(BaseModel):
    task_id: str
    status: str = "pending"


class StyleResponse(BaseModel):
    composed: str = ""
    fingerprint: dict[str, Any] = {}
    manifest: str = ""
