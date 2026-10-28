"""Authenticated ingestion and public reads for AI social-event batches."""

from __future__ import annotations

from datetime import datetime, timezone
import hmac
import json
import logging
import re

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from ..dependencies import get_db
from ..models import XEventReport, XPost
from ..schemas import (
    XEventIngestRequest,
    XEventLatestResponse,
    XEventPostPublic,
    XEventPublic,
    XEventReportPublic,
)

router = APIRouter(prefix="/api/v1", tags=["x-events"])
logger = logging.getLogger(__name__)
MAX_INGEST_BODY_BYTES = 1_048_576
IDEMPOTENCY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _authenticate(request: Request) -> None:
    expected = getattr(request.app.state.settings, "x_ingest_token", None)
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="X ingestion is not configured",
        )
    authorization = request.headers.get("authorization", "")
    scheme, separator, supplied = authorization.partition(" ")
    if (
        not separator
        or scheme.lower() != "bearer"
        or not supplied
        or not hmac.compare_digest(supplied, expected)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def _read_bounded_body(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_INGEST_BODY_BYTES:
                raise HTTPException(status_code=413, detail="Request body too large")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length") from None

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_INGEST_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Request body too large")
        body.extend(chunk)
    return bytes(body)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _existing_report(db: Session, idempotency_key: str) -> XEventReport | None:
    return db.scalar(
        select(XEventReport).where(XEventReport.idempotency_key == idempotency_key)
    )


def _duplicate_result(report: XEventReport, submitted_count: int) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={
            "accepted": 0,
            "duplicates": submitted_count,
            "reportId": report.id,
        },
    )


@router.post("/ingest/x")
async def ingest_x_events(
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="X-Idempotency-Key"),
    db: Session = Depends(get_db),
) -> JSONResponse:
    _authenticate(request)
    if not idempotency_key or not IDEMPOTENCY_PATTERN.fullmatch(idempotency_key):
        raise HTTPException(status_code=422, detail="Invalid idempotency key")

    body = await _read_bounded_body(request)
    try:
        batch = XEventIngestRequest.model_validate_json(body)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid X event payload") from None

    post_ids = [post.id for post in batch.posts]
    if len(set(post_ids)) != len(post_ids):
        raise HTTPException(status_code=422, detail="Duplicate post IDs in batch")
    allowed_ids = set(post_ids)
    if any(
        post_id not in allowed_ids
        for event in batch.summary.events
        for post_id in event.post_ids
    ):
        raise HTTPException(status_code=422, detail="Event references a post outside this batch")

    existing = _existing_report(db, idempotency_key)
    if existing is not None:
        return _duplicate_result(existing, len(batch.posts))

    for attempt in range(2):
        try:
            existing_posts = {
                post.external_id: post
                for post in db.scalars(
                    select(XPost).where(
                        XPost.provider == batch.provider,
                        XPost.external_id.in_(post_ids),
                    )
                )
            }
            new_count = 0
            for item in batch.posts:
                if item.id in existing_posts:
                    continue
                db.add(
                    XPost(
                        provider=batch.provider,
                        external_id=item.id,
                        author=item.author,
                        username=item.username,
                        text=item.text,
                        canonical_url=item.url,
                        published_at=_utc(item.published_at),
                        importance=item.importance,
                    )
                )
                new_count += 1

            report = XEventReport(
                idempotency_key=idempotency_key,
                status="published",
                model_provider=batch.model_provider,
                model_name=batch.model_name,
                title=batch.summary.title,
                summary_markdown=batch.summary.summary,
                events_json=[event.model_dump(by_alias=True) for event in batch.summary.events],
                risks_json=batch.summary.risks,
                post_ids_json=[
                    {"provider": batch.provider, "external_id": post_id}
                    for post_id in post_ids
                ],
            )
            db.add(report)
            db.commit()
            return JSONResponse(
                status_code=201,
                content={
                    "accepted": new_count,
                    "duplicates": len(batch.posts) - new_count,
                    "reportId": report.id,
                },
            )
        except IntegrityError:
            db.rollback()
            existing = _existing_report(db, idempotency_key)
            if existing is not None:
                return _duplicate_result(existing, len(batch.posts))
            if attempt == 0:
                continue
            logger.warning("x_event_ingest_conflict", extra={"error_type": "IntegrityError"})
            raise HTTPException(status_code=409, detail="Batch conflict; retry safely") from None
        except HTTPException:
            db.rollback()
            raise
        except Exception as exc:
            db.rollback()
            logger.error(
                "x_event_ingest_failed",
                extra={"error_type": type(exc).__name__},
            )
            raise HTTPException(status_code=500, detail="X event ingestion failed") from None

    raise HTTPException(status_code=409, detail="Batch conflict; retry safely")


@router.get("/x-events/latest", response_model=XEventLatestResponse)
def latest_x_events(db: Session = Depends(get_db)) -> XEventLatestResponse:
    report = db.scalar(
        select(XEventReport)
        .order_by(
            XEventReport.received_at.desc(),
            XEventReport.created_at.desc(),
            XEventReport.id.desc(),
        )
        .limit(1)
    )
    if report is None:
        return XEventLatestResponse(report=None, posts=[])

    references = report.post_ids_json
    keys = {
        (reference.get("provider"), reference.get("external_id"))
        for reference in references
        if isinstance(reference, dict)
    }
    providers = {provider for provider, _ in keys if provider}
    external_ids = {external_id for _, external_id in keys if external_id}
    candidates = list(
        db.scalars(
            select(XPost).where(
                XPost.provider.in_(providers or {""}),
                XPost.external_id.in_(external_ids or {""}),
            )
        )
    )
    post_by_key = {(post.provider, post.external_id): post for post in candidates}
    posts: list[XEventPostPublic] = []
    for reference in references:
        if not isinstance(reference, dict):
            continue
        post = post_by_key.get((reference.get("provider"), reference.get("external_id")))
        if post is None:
            continue
        posts.append(
            XEventPostPublic(
                provider=post.provider,
                external_id=post.external_id,
                author=post.author,
                username=post.username,
                text=post.text,
                canonical_url=post.canonical_url,
                published_at=_utc(post.published_at),
                importance=post.importance,
            )
        )
    public_report = XEventReportPublic(
        id=report.id,
        status=report.status,
        model_provider=report.model_provider,
        model_name=report.model_name,
        title=report.title,
        summary=report.summary_markdown,
        events=[XEventPublic.model_validate(event) for event in report.events_json],
        risks=report.risks_json,
        post_ids=references,
        received_at=_utc(report.received_at),
    )
    return XEventLatestResponse(report=public_report, posts=posts)
