"""Stable public models for CatDesk morning research and stock evidence."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class ImportantNewsItem(BaseModel):
    id: str
    title: str
    summary: str
    published_at: datetime
    source: str
    url: str = ""
    themes: list[str] = Field(default_factory=list)
    symbols: list[str] = Field(default_factory=list)
    importance_score: float
    tone: Literal["positive", "risk", "neutral"] = "neutral"


class ThemeSignal(BaseModel):
    id: str
    name: str
    logic: str
    average_change_pct: float
    signal_score: float
    breadth: float
    summary: str


class CandidateEvidence(BaseModel):
    symbol: str
    name: str
    exchange: str
    industry: str
    theme: str
    total_score: float
    rationale: str
    dimension_scores: dict[str, float] = Field(default_factory=dict)
    historical_stats: dict[str, float | int | str | None] = Field(default_factory=dict)
    positive_flags: list[str] = Field(default_factory=list)
    risk_flags: list[str] = Field(default_factory=list)
    invalid_conditions: list[str] = Field(default_factory=list)
    news: list[ImportantNewsItem] = Field(default_factory=list)


class MorningReport(BaseModel):
    report_date: date
    generated_at: datetime
    previous_trade_date: date
    freshness: Literal["current", "stale"] = "current"
    previous_success_date: date | None = None
    market_summary: str
    themes: list[ThemeSignal]
    important_news: list[ImportantNewsItem]
    catalyst_candidates: list[CandidateEvidence]


class MorningReportHistoryItem(BaseModel):
    report_date: date
    generated_at: datetime


class MorningReportHistoryResponse(BaseModel):
    items: list[MorningReportHistoryItem]


class ResearchSourceEvidence(BaseModel):
    source_id: Literal["catalyst", "user_strategy"]
    source_name: str
    score: float | None
    reasons: list[str]


class StockResearchContext(BaseModel):
    symbol: str
    name: str
    exchange: str
    cross_hit: bool
    sources: list[ResearchSourceEvidence]
    catalyst: CandidateEvidence | None = None
