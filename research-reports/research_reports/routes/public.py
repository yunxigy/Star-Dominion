"""Public read-only research report endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..collector.github import CATEGORIES
from ..dependencies import get_db
from ..models import AICatalogEntry, AIReport, CollectionRun, ContentSource, HourlyObservation, NewsItem, RankingEntry, Repository, WeeklyIssue
from ..schemas import (
    IssuePage,
    IssueSummary,
    RankingRepository,
    RankingResponse,
    RankingSummary,
    RepositoryDetail,
    ServiceStatus,
    AICatalogResponse,
    AICatalogRepository,
    NewsItemPublic,
    NewsPage,
    BriefingPublic,
)
from ..services.rankings import EntryView, hourly_delta, summarize


router = APIRouter(prefix="/api/v1", tags=["reports"])


def _issue_or_404(db: Session, issue_id: str) -> WeeklyIssue:
    issue = db.get(WeeklyIssue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="研报期数不存在")
    return issue


@router.get("/issues", response_model=IssuePage)
def list_issues(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    db: Session = Depends(get_db),
) -> IssuePage:
    statement = select(WeeklyIssue).order_by(WeeklyIssue.starts_at.desc()).limit(limit + 1)
    if cursor:
        cursor_issue = db.get(WeeklyIssue, cursor)
        if cursor_issue is not None:
            statement = statement.where(WeeklyIssue.starts_at < cursor_issue.starts_at)
    rows = list(db.scalars(statement))
    next_cursor = rows[limit - 1].id if len(rows) > limit else None
    return IssuePage(items=rows[:limit], next_cursor=next_cursor)


@router.get("/issues/current", response_model=IssueSummary)
def current_issue(db: Session = Depends(get_db)) -> WeeklyIssue:
    issue = db.scalar(select(WeeklyIssue).order_by(WeeklyIssue.starts_at.desc()))
    if issue is None:
        raise HTTPException(status_code=404, detail="当前研报尚未建立")
    return issue


@router.get("/issues/{issue_id}", response_model=IssueSummary)
def issue_detail(issue_id: str, db: Session = Depends(get_db)) -> WeeklyIssue:
    return _issue_or_404(db, issue_id)


@router.get("/issues/{issue_id}/rankings", response_model=RankingResponse)
def issue_rankings(
    issue_id: str,
    category: str = Query(default="all"),
    query: str | None = None,
    language: str | None = None,
    license: str | None = None,
    ranking_status: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
) -> RankingResponse:
    if category not in CATEGORIES:
        raise HTTPException(status_code=422, detail="不支持的榜单分类")
    issue = _issue_or_404(db, issue_id)
    statement = (
        select(RankingEntry, Repository)
        .join(Repository, Repository.id == RankingEntry.repository_id)
        .where(RankingEntry.issue_id == issue_id, RankingEntry.category == category)
        .order_by(RankingEntry.rank)
    )
    if query:
        pattern = f"%{query.strip()}%"
        statement = statement.where(
            or_(
                Repository.full_name.ilike(pattern),
                Repository.owner.ilike(pattern),
                Repository.description.ilike(pattern),
            )
        )
    if language:
        statement = statement.where(func.lower(Repository.primary_language) == language.lower())
    if license:
        statement = statement.where(func.lower(Repository.license_spdx) == license.lower())
    if ranking_status:
        statement = statement.where(RankingEntry.status == ranking_status)

    items: list[RankingRepository] = []
    summary_entries: list[EntryView] = []
    for entry, repository in db.execute(statement).all():
        observations = list(
            db.scalars(
                select(HourlyObservation)
                .where(
                    HourlyObservation.issue_id == issue_id,
                    HourlyObservation.repository_id == repository.id,
                    HourlyObservation.category == category,
                )
                .order_by(HourlyObservation.observed_at.desc())
                .limit(2)
            )
        )
        rank_change = None
        star_change = None
        if len(observations) == 2:
            change = hourly_delta(
                current_rank=observations[0].rank,
                current_stars=observations[0].stars_total,
                previous_rank=observations[1].rank,
                previous_stars=observations[1].stars_total,
            )
            rank_change = change.rank_change
            star_change = change.star_change
        items.append(
            RankingRepository(
                id=repository.id,
                full_name=repository.full_name,
                owner=repository.owner,
                name=repository.name,
                description=repository.description,
                primary_language=repository.primary_language,
                topics=list(repository.topics_json or []),
                license_spdx=repository.license_spdx,
                html_url=repository.html_url,
                is_archived=repository.is_archived,
                stars_total=repository.stars_total,
                forks_total=repository.forks_total,
                github_updated_at=repository.github_updated_at,
                rank=entry.rank,
                previous_issue_rank=entry.previous_issue_rank,
                stars_since_weekly=entry.stars_since_weekly,
                first_seen_at=entry.first_seen_at,
                last_seen_at=entry.last_seen_at,
                consecutive_weeks=entry.consecutive_weeks,
                status=entry.status,
                hourly_rank_change=rank_change,
                hourly_star_change=star_change,
            )
        )
        summary_entries.append(
            EntryView(
                full_name=repository.full_name,
                rank=entry.rank,
                stars_since_weekly=entry.stars_since_weekly,
                status=entry.status,
                consecutive_weeks=entry.consecutive_weeks,
            )
        )
    calculated = summarize(summary_entries)
    return RankingResponse(
        issue=IssueSummary.model_validate(issue),
        category=category,
        items=items,
        summary=RankingSummary.model_validate(calculated),
    )


@router.get("/repositories/{owner}/{name}", response_model=RepositoryDetail)
def repository_detail(owner: str, name: str, db: Session = Depends(get_db)) -> RepositoryDetail:
    repository = db.scalar(
        select(Repository).where(
            func.lower(Repository.full_name) == f"{owner}/{name}".lower()
        )
    )
    if repository is None:
        raise HTTPException(status_code=404, detail="仓库不存在")
    return RepositoryDetail(
        id=repository.id,
        full_name=repository.full_name,
        owner=repository.owner,
        name=repository.name,
        description=repository.description,
        primary_language=repository.primary_language,
        topics=list(repository.topics_json or []),
        license_spdx=repository.license_spdx,
        html_url=repository.html_url,
        default_branch=repository.default_branch,
        is_archived=repository.is_archived,
        stars_total=repository.stars_total,
        forks_total=repository.forks_total,
        github_updated_at=repository.github_updated_at,
    )


@router.get("/status", response_model=ServiceStatus)
def service_status(request: Request, db: Session = Depends(get_db)) -> ServiceStatus:
    latest_run = db.scalar(
        select(CollectionRun)
        .where(CollectionRun.status.in_(("success", "partial")))
        .order_by(CollectionRun.finished_at.desc())
    )
    current = db.scalar(select(WeeklyIssue).order_by(WeeklyIssue.starts_at.desc()))
    delayed: list[str] = []
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=90)
    if current is not None:
        for category in CATEGORIES:
            latest_observation = db.scalar(
                select(func.max(HourlyObservation.observed_at)).where(
                    HourlyObservation.issue_id == current.id,
                    HourlyObservation.category == category,
                )
            )
            if latest_observation is None or _as_utc(latest_observation) < cutoff:
                delayed.append(category)
    scheduler = getattr(request.app.state, "scheduler", None)
    next_run = None
    if scheduler is not None:
        dates = [job.next_run_time for job in scheduler.get_jobs() if job.next_run_time]
        next_run = min(dates) if dates else None
    return ServiceStatus(
        status="delayed" if delayed else "ok",
        latest_successful_collection_at=(latest_run.finished_at if latest_run else None),
        next_scheduled_at=next_run,
        delayed_categories=delayed,
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@router.get("/ai/rankings", response_model=AICatalogResponse)
def ai_rankings(category: str = Query(default="all"), db: Session = Depends(get_db)) -> AICatalogResponse:
    issue = db.scalar(select(WeeklyIssue).order_by(WeeklyIssue.starts_at.desc()))
    if issue is None:
        return AICatalogResponse(category=category, items=[], updated_at=None)
    statement = (
        select(AICatalogEntry, Repository)
        .join(Repository, Repository.id == AICatalogEntry.repository_id)
        .where(AICatalogEntry.issue_id == issue.id, AICatalogEntry.status == "active")
    )
    if category != "all":
        statement = statement.where(AICatalogEntry.category == category)
    statement = statement.order_by(AICatalogEntry.score.desc(), Repository.full_name)
    items: list[AICatalogRepository] = []
    seen: set[str] = set()
    for entry, repository in db.execute(statement).all():
        if repository.full_name.lower() in seen:
            continue
        seen.add(repository.full_name.lower())
        items.append(AICatalogRepository(id=repository.id, full_name=repository.full_name, html_url=repository.html_url, description=repository.description, primary_language=repository.primary_language, category=entry.category, score=entry.score, reasons=list(entry.reasons_json or []), stars_total=repository.stars_total, stars_since_weekly=0))
    # Fallback: if no persisted entries exist, compute on-the-fly from rankings
    if not items:
        rows = db.execute(select(RankingEntry, Repository).join(Repository, Repository.id == RankingEntry.repository_id).where(RankingEntry.issue_id == issue.id)).all()
        from ..services.ai_catalog import classify_repository
        for entry, repository in rows:
            match = classify_repository(name=repository.full_name, description=repository.description, topics=list(repository.topics_json or []))
            if category != "all" and category not in match.categories:
                continue
            if match.primary_category == "other" or repository.full_name.lower() in seen:
                continue
            seen.add(repository.full_name.lower())
            items.append(AICatalogRepository(id=repository.id, full_name=repository.full_name, html_url=repository.html_url, description=repository.description, primary_language=repository.primary_language, category=match.primary_category, score=match.score, reasons=list(match.reasons), stars_total=repository.stars_total, stars_since_weekly=entry.stars_since_weekly))
    items.sort(key=lambda item: (-item.score, -item.stars_since_weekly, item.full_name))
    return AICatalogResponse(category=category, items=items[:100], updated_at=issue.starts_at)


@router.get("/news", response_model=NewsPage)
def news_items(window: str = Query(default="24h"), topic: str | None = None, db: Session = Depends(get_db)) -> NewsPage:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24 if window == "24h" else 6)
    statement = select(NewsItem).where(NewsItem.published_at >= cutoff).order_by(NewsItem.published_at.desc()).limit(100)
    rows = list(db.scalars(statement))
    if topic:
        rows = [row for row in rows if topic.lower() in {value.lower() for value in (row.topics_json or [])}]
    return NewsPage(items=[NewsItemPublic(id=row.id, source_id=row.source_id, canonical_url=row.canonical_url, title=row.title, summary=row.summary, published_at=row.published_at, author_or_publisher=row.author_or_publisher, topics=list(row.topics_json or []), importance_score=row.importance_score, status=row.status) for row in rows])


@router.get("/news/social-events", response_model=NewsPage)
def social_events(window: str = Query(default="24h"), db: Session = Depends(get_db)) -> NewsPage:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24 if window == "24h" else 6)
    x_source_ids = list(db.scalars(select(ContentSource.id).where(ContentSource.kind == "x_indexed")))
    if not x_source_ids:
        return NewsPage(items=[])
    rows = list(db.scalars(select(NewsItem).where(NewsItem.published_at >= cutoff, NewsItem.source_id.in_(x_source_ids)).order_by(NewsItem.published_at.desc()).limit(100)))
    return NewsPage(items=[NewsItemPublic(id=row.id, source_id=row.source_id, canonical_url=row.canonical_url, title=row.title, summary=row.summary, published_at=row.published_at, author_or_publisher=row.author_or_publisher, topics=list(row.topics_json or []), importance_score=row.importance_score, status=row.status) for row in rows])


@router.get("/briefings/latest", response_model=BriefingPublic)
def latest_briefing(db: Session = Depends(get_db)) -> BriefingPublic:
    report = db.scalar(select(AIReport).order_by(AIReport.report_date.desc()))
    if report is None:
        raise HTTPException(status_code=404, detail="AI早报尚未生成")
    return BriefingPublic(id=report.id, report_date=report.report_date, window_start=report.window_start, window_end=report.window_end, status=report.status, model_provider=report.model_provider, model_name=report.model_name, title=report.title, summary_markdown=report.summary_markdown, events=list(report.events_json or []), risks=list(report.risks_json or []), source_ids=list(report.source_ids_json or []), generated_at=report.generated_at, error_message=report.error_message)
