"""Fetch and persist public RSS news candidates."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select

from ..collector.news_queries import default_sources
from ..collector.rss import parse_rss
from ..database import Database
from ..models import ContentSource, NewsItem
from .news_items import normalize_url, rank_news_items, title_similarity


def collect_public_news(database: Database, *, http: httpx.Client, now: datetime | None = None) -> dict[str, int]:
    current = now or datetime.now(timezone.utc)
    counts: dict[str, int] = {}
    for config in default_sources():
        with database.sessions() as session:
            source = session.scalar(select(ContentSource).where(ContentSource.name == config.name))
            if source is None:
                source = ContentSource(kind=config.kind, name=config.name, url=config.url)
                session.add(source)
                session.flush()
                session.commit()
            source_id = source.id
        try:
            response = http.get(config.url, timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=True, headers={"User-Agent": "dream-chaser-research-reports/0.1"})
            response.raise_for_status()
            parsed = parse_rss(response.text, source_id=source_id, now=current)
            ranked = rank_news_items(parsed)
            with database.sessions() as session:
                source = session.get(ContentSource, source_id)
                recent_cutoff = current - timedelta(hours=24)
                recent_titles = [
                    " ".join(title.casefold().split())
                    for title in session.scalars(
                        select(NewsItem.title).where(NewsItem.published_at >= recent_cutoff)
                    )
                    if title
                ]
                for item in ranked:
                    # Per-source dedup
                    exists = session.scalar(select(NewsItem).where(NewsItem.source_id == source_id, NewsItem.content_hash == item.content_hash))
                    if exists is not None:
                        continue
                    # Cross-source title dedup: RSS providers often syndicate the same
                    # event with different tracking URLs and source-specific links.
                    title_key = " ".join(item.title.casefold().split())
                    if any(
                        title_key == existing_title
                        or title_similarity(title_key, existing_title) > 0.8
                        for existing_title in recent_titles
                    ):
                        continue
                    # Cross-source URL dedup: skip if same normalized URL already exists from another source
                    norm_url = normalize_url(item.canonical_url)
                    existing_by_url = session.scalar(
                        select(NewsItem).where(func.lower(NewsItem.canonical_url).like(f"%{norm_url[-80:]}%")).limit(1)
                    )
                    if existing_by_url is not None:
                        if normalize_url(existing_by_url.canonical_url) == norm_url:
                            continue
                    session.add(NewsItem(source_id=source_id, canonical_url=item.canonical_url, title=item.title, summary=item.summary, published_at=item.published_at, author_or_publisher=item.author_or_publisher, topics_json=list(config.topics + item.topics), importance_score=item.importance_score, content_hash=item.content_hash))
                    recent_titles.append(title_key)
                if source is not None:
                    source.last_success_at = current
                    source.last_error = None
                session.commit()
            counts[config.name] = len(ranked)
        except Exception as exc:
            with database.sessions() as session:
                source = session.get(ContentSource, source_id)
                if source is not None:
                    source.last_error = type(exc).__name__
                    session.commit()
            counts[config.name] = 0
    return counts
