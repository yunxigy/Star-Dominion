"""Public domain models for the real-source Mom Index."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class MomPostEvidence(BaseModel):
    platform: Literal["eastmoney", "xiaohongshu"]
    platform_id: str
    title: str
    url: HttpUrl | None = None
    published_at: datetime | None = None
    collected_at: datetime
    reasoning: str
    intent: Literal["buy", "sell", "neutral"]


class MomSourceStatus(BaseModel):
    source_id: Literal["eastmoney", "xiaohongshu"]
    status: Literal["ok", "error", "login_required", "risk_controlled"]
    collected_at: datetime
    post_count: int = Field(ge=0)
    message: str | None = None


class MomSectorIndex(BaseModel):
    sector_id: Literal["nasdaq", "gold", "cpo", "semiconductor"]
    name: str
    index: float = Field(ge=0, le=100)
    buy_index: float = Field(ge=0, le=100)
    sell_index: float = Field(ge=0, le=100)
    total_posts: int = Field(ge=0)
    valid_posts: int = Field(ge=0)
    newbie_posts: int = Field(ge=0)
    newbie_ratio: float = Field(ge=0, le=100)
    buy_count: int = Field(ge=0)
    sell_count: int = Field(ge=0)
    risk_level: Literal["cold", "normal", "warming", "warning", "extreme"]
    interpretation: str
    top_posts: list[MomPostEvidence]


class MomIndexSnapshot(BaseModel):
    snapshot_date: date
    generated_at: datetime
    completeness: Literal["complete", "partial"]
    sectors: dict[str, MomSectorIndex]
    sources: list[MomSourceStatus]
    stale: bool = False


class MomIndexHistoryResponse(BaseModel):
    items: list[MomIndexSnapshot]
