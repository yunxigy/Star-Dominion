"""Normalize and rank public news candidates."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse, parse_qs, unquote

from ..collector.rss import RSSItem


@dataclass(frozen=True, slots=True)
class RankedNewsItem(RSSItem):
    importance_score: int
    topics: tuple[str, ...]


def normalize_url(url: str) -> str:
    """Normalize a URL for cross-source deduplication.

    Strips Google News redirect wrappers, removes tracking parameters,
    lowercases the domain, and removes trailing slashes.
    """
    parsed = urlparse(url)

    # Unwrap Google News redirect: https://news.google.com/rss/articles/... or
    # https://news.google.com/articles/...
    if parsed.netloc in ("news.google.com", "news.google.com.") and "/articles/" in parsed.path:
        # Try to extract the real URL from the base64-encoded cluster or rurl param
        # Google News RSS links are typically in the form:
        # https://news.google.com/rss/articles/CBMi... or with ?rurl= param
        query_params = parse_qs(parsed.query)
        if "rurl" in query_params:
            real_url = unquote(query_params["rurl"][0])
            if real_url.startswith("http"):
                return normalize_url(real_url)

    # Remove common tracking parameters
    tracking_params = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
                       "fbclid", "gclid", "ref", "source", "share"}
    query_params = parse_qs(parsed.query, keep_blank_values=True)
    clean_params = {k: v for k, v in query_params.items() if k.lower() not in tracking_params}

    # Rebuild URL
    domain = parsed.netloc.lower()
    # Remove www. prefix for normalization
    if domain.startswith("www."):
        domain = domain[4:]
    path = parsed.path.rstrip("/") or "/"

    # Sort params for consistent ordering
    sorted_params = sorted(clean_params.items())
    if sorted_params:
        param_str = "&".join(f"{k}={v[0]}" for k, v in sorted_params)
        return f"{parsed.scheme}://{domain}{path}?{param_str}"
    return f"{parsed.scheme}://{domain}{path}"


def title_similarity(title_a: str, title_b: str) -> float:
    """Simple word-overlap similarity for cross-source title dedup."""
    words_a = set(title_a.lower().split())
    words_b = set(title_b.lower().split())
    if not words_a or not words_b:
        return 0.0
    overlap = words_a & words_b
    return len(overlap) / min(len(words_a), len(words_b))


def rank_news_items(items: list[RSSItem]) -> list[RankedNewsItem]:
    seen_urls: dict[str, str] = {}  # normalized_url -> item content_hash (first seen wins)
    seen_titles: dict[str, str] = {}  # lowercased title -> content_hash
    ranked: list[RankedNewsItem] = []
    rules = {
        "model": ("model", "llm", "gpt", "deepseek"),
        "agent": ("agent", "mcp", "copilot"),
        "company": ("openai", "google", "anthropic", "meta", "microsoft", "nvidia"),
        "policy": ("trump", "policy", "regulation", "government"),
    }
    for item in items:
        # Cross-source URL dedup: if we've seen this normalized URL from another source, skip
        norm_url = normalize_url(item.canonical_url)
        if norm_url in seen_urls:
            continue
        # Cross-source title dedup: very similar titles are likely the same story
        title_lower = item.title.lower().strip()
        duplicate = False
        for existing_title, existing_hash in seen_titles.items():
            if existing_hash != item.content_hash and title_similarity(title_lower, existing_title) > 0.7:
                duplicate = True
                break
        if duplicate:
            continue
        seen_urls[norm_url] = item.content_hash
        seen_titles[title_lower] = item.content_hash

        text = f"{item.title} {item.summary or ''}".lower()
        topics = tuple(topic for topic, terms in rules.items() if any(term in text for term in terms))
        score = 1 + 2 * len(topics)
        if any(term in text for term in ("release", "launch", "announces", "acquire")):
            score += 3
        ranked.append(RankedNewsItem(
            source_id=item.source_id,
            canonical_url=item.canonical_url,
            title=item.title,
            summary=item.summary,
            published_at=item.published_at,
            author_or_publisher=item.author_or_publisher,
            content_hash=item.content_hash,
            importance_score=score,
            topics=topics,
        ))
    ranked.sort(key=lambda item: (-item.importance_score, -item.published_at.timestamp(), item.title))
    return ranked
