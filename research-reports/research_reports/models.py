"""Persistent models for GitHub weekly research reports."""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Repository(Base):
    __tablename__ = "repositories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    full_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    owner: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    primary_language: Mapped[str | None] = mapped_column(String(64), nullable=True)
    topics_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    license_spdx: Mapped[str | None] = mapped_column(String(64), nullable=True)
    html_url: Mapped[str] = mapped_column(String(512))
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    stars_total: Mapped[int] = mapped_column(Integer, default=0)
    forks_total: Mapped[int] = mapped_column(Integer, default=0)
    github_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_etag: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)


class WeeklyIssue(Base):
    __tablename__ = "weekly_issues"
    __table_args__ = (UniqueConstraint("iso_year", "iso_week", name="uq_weekly_issue"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    iso_year: Mapped[int] = mapped_column(Integer)
    iso_week: Mapped[int] = mapped_column(Integer)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="collecting")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class RankingEntry(Base):
    __tablename__ = "ranking_entries"
    __table_args__ = (
        UniqueConstraint("issue_id", "category", "repository_id", name="uq_ranking_entry"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    issue_id: Mapped[str] = mapped_column(ForeignKey("weekly_issues.id"), index=True)
    repository_id: Mapped[str] = mapped_column(ForeignKey("repositories.id"), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    rank: Mapped[int] = mapped_column(Integer)
    previous_issue_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stars_since_weekly: Mapped[int] = mapped_column(Integer, default=0)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    consecutive_weeks: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="new")


class HourlyObservation(Base):
    __tablename__ = "hourly_observations"
    __table_args__ = (
        UniqueConstraint(
            "issue_id",
            "repository_id",
            "category",
            "observed_at",
            name="uq_hourly_observation",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    issue_id: Mapped[str] = mapped_column(ForeignKey("weekly_issues.id"), index=True)
    repository_id: Mapped[str] = mapped_column(ForeignKey("repositories.id"), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    rank: Mapped[int] = mapped_column(Integer)
    stars_total: Mapped[int] = mapped_column(Integer, default=0)
    stars_since_weekly: Mapped[int] = mapped_column(Integer, default=0)


class CollectionRun(Base):
    __tablename__ = "collection_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    trigger: Mapped[str] = mapped_column(String(32), index=True)
    requested_by_site_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    categories_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
