"""Small dependency-free RSS parser for public news sources."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
from html import unescape
from urllib.parse import urlparse
from xml.etree import ElementTree


@dataclass(frozen=True, slots=True)
class RSSItem:
    source_id: str
    canonical_url: str
    title: str
    summary: str | None
    published_at: datetime
    author_or_publisher: str | None
    content_hash: str


def parse_rss(
    xml: str,
    *,
    source_id: str,
    now: datetime | None = None,
    window_hours: int = 24,
) -> list[RSSItem]:
    current = now or datetime.now(timezone.utc)
    root = ElementTree.fromstring(xml)
    items: list[RSSItem] = []
    for node in root.findall(".//item"):
        title = _text(node.find("title"))
        url = _text(node.find("link"))
        published = _parse_date(_text(node.find("pubDate")))
        if not title or not url or not _is_http_url(url) or published is None:
            continue
        if published < current - timedelta(hours=window_hours) or published > current + timedelta(minutes=10):
            continue
        summary = _clean_text(_text(node.find("description")))
        publisher = _text(node.find("source")) or _text(node.find("author"))
        digest = hashlib.sha256(f"{url}|{title}|{published.isoformat()}".encode()).hexdigest()
        items.append(
            RSSItem(
                source_id=source_id,
                canonical_url=url,
                title=title,
                summary=summary,
                published_at=published,
                author_or_publisher=publisher,
                content_hash=digest,
            )
        )
    return items


def _text(node: ElementTree.Element | None) -> str | None:
    if node is None or node.text is None:
        return None
    value = unescape(" ".join(node.itertext())).strip()
    return value or None


def _clean_text(value: str | None) -> str | None:
    if not value:
        return None
    return " ".join(value.split())[:2000] or None


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)


def _is_http_url(value: str) -> bool:
    return urlparse(value).scheme in {"http", "https"} and bool(urlparse(value).netloc)
