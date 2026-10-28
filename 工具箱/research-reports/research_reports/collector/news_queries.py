"""Public RSS source definitions for AI news and indexed social posts."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote_plus


@dataclass(frozen=True, slots=True)
class RSSSourceConfig:
    name: str
    kind: str
    url: str
    topics: tuple[str, ...]


def google_news_source(name: str, query: str, *, kind: str = "news_report", topics: tuple[str, ...] = ("ai",)) -> RSSSourceConfig:
    encoded = quote_plus(query)
    return RSSSourceConfig(name=name, kind=kind, url=f"https://news.google.com/rss/search?q={encoded}&hl=en-US&gl=US&ceid=US:en", topics=topics)


def default_sources() -> tuple[RSSSourceConfig, ...]:
    return (
        google_news_source("AI releases", "artificial intelligence model release", topics=("ai", "model")),
        google_news_source("AI agents", "AI agent OR MCP OR coding agent", topics=("ai", "agent")),
        google_news_source("AI companies", "OpenAI OR Google AI OR Anthropic OR Meta AI", topics=("ai", "company")),
        google_news_source("AI policy", "Trump AI policy OR AI regulation", topics=("ai", "policy")),
        google_news_source("Indexed X AI events", "site:x.com AI OpenAI Google Anthropic", kind="x_indexed", topics=("ai", "social")),
        google_news_source("Indexed Twitter AI events", "site:twitter.com AI OpenAI Google Anthropic", kind="x_indexed", topics=("ai", "social")),
    )
