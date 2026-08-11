"""Value objects produced by GitHub collectors."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class TrendingRepository:
    category: str
    rank: int
    full_name: str
    description: str | None
    primary_language: str | None
    stars_total: int
    forks_total: int
    stars_since_weekly: int
    contributor_urls: tuple[str, ...]
    html_url: str


@dataclass(frozen=True, slots=True)
class RepositoryMetadata:
    full_name: str
    description: str | None
    primary_language: str | None
    topics: tuple[str, ...]
    license_spdx: str | None
    default_branch: str | None
    is_archived: bool
    stars_total: int
    forks_total: int
    github_updated_at: datetime | None
    etag: str | None


@dataclass(frozen=True, slots=True)
class NotModified:
    etag: str | None
