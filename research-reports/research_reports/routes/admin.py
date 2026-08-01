"""Administrator collection endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..dependencies import get_db
from ..models import CollectionRun
from ..schemas import CollectionRunPage, CollectionRunPublic, CollectionStart
from ..site_auth import SiteIdentity, require_admin


router = APIRouter(prefix="/api/v1/admin", tags=["reports-admin"])


def _public(run: CollectionRun) -> CollectionRunPublic:
    return CollectionRunPublic(
        id=run.id,
        trigger=run.trigger,
        requested_by_site_user_id=run.requested_by_site_user_id,
        started_at=run.started_at,
        finished_at=run.finished_at,
        status=run.status,
        categories=dict(run.categories_json or {}),
        error_summary=run.error_summary,
        duration_ms=run.duration_ms,
    )


@router.post("/collections", response_model=CollectionStart, status_code=202)
def start_collection(
    request: Request,
    identity: SiteIdentity = Depends(require_admin),
) -> CollectionStart:
    triggered = request.app.state.collection_coordinator.trigger(
        trigger="manual",
        requested_by=identity.id,
    )
    if not triggered.accepted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="已有采集任务运行中",
        )
    return CollectionStart(run_id=str(triggered.run_id), status=triggered.status)


@router.get("/collections", response_model=CollectionRunPage)
def list_collections(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = None,
    _: SiteIdentity = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CollectionRunPage:
    statement = select(CollectionRun).order_by(CollectionRun.started_at.desc()).limit(limit + 1)
    if cursor:
        cursor_run = db.get(CollectionRun, cursor)
        if cursor_run is not None:
            statement = statement.where(CollectionRun.started_at < cursor_run.started_at)
    rows = list(db.scalars(statement))
    next_cursor = rows[limit - 1].id if len(rows) > limit else None
    return CollectionRunPage(
        items=[_public(run) for run in rows[:limit]],
        next_cursor=next_cursor,
    )


@router.get("/collections/{run_id}", response_model=CollectionRunPublic)
def collection_detail(
    run_id: str,
    _: SiteIdentity = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CollectionRunPublic:
    run = db.get(CollectionRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="采集记录不存在")
    return _public(run)
