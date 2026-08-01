"""Public API contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


def _camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class IssueSummary(ApiModel):
    id: str
    iso_year: int
    iso_week: int
    starts_at: datetime
    sealed_at: datetime | None
    status: str


class IssuePage(ApiModel):
    items: list[IssueSummary]
    next_cursor: str | None = None


class RankingRepository(ApiModel):
    id: str
    full_name: str
    owner: str
    name: str
    description: str | None
    primary_language: str | None
    topics: list[str]
    license_spdx: str | None
    html_url: str
    is_archived: bool
    stars_total: int
    forks_total: int
    github_updated_at: datetime | None
    rank: int
    previous_issue_rank: int | None
    stars_since_weekly: int
    first_seen_at: datetime
    last_seen_at: datetime
    consecutive_weeks: int
    status: str
    hourly_rank_change: int | None
    hourly_star_change: int | None


class RankingSummary(ApiModel):
    new_count: int
    continuing_count: int
    stars_since_weekly_total: int
    fastest_growth_full_name: str | None


class RankingResponse(ApiModel):
    issue: IssueSummary
    category: str
    items: list[RankingRepository]
    summary: RankingSummary


class RepositoryDetail(ApiModel):
    id: str
    full_name: str
    owner: str
    name: str
    description: str | None
    primary_language: str | None
    topics: list[str]
    license_spdx: str | None
    html_url: str
    default_branch: str | None
    is_archived: bool
    stars_total: int
    forks_total: int
    github_updated_at: datetime | None


class ServiceStatus(ApiModel):
    status: str
    latest_successful_collection_at: datetime | None
    next_scheduled_at: datetime | None
    delayed_categories: list[str]


class CollectionStart(ApiModel):
    run_id: str
    status: str


class CollectionRunPublic(ApiModel):
    id: str
    trigger: str
    requested_by_site_user_id: str | None
    started_at: datetime
    finished_at: datetime | None
    status: str
    categories: dict[str, Any]
    error_summary: str | None
    duration_ms: int | None


class CollectionRunPage(ApiModel):
    items: list[CollectionRunPublic]
    next_cursor: str | None = None

