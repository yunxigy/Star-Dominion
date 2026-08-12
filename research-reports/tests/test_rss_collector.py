from datetime import datetime, timezone
from pathlib import Path

import httpx

from research_reports.collector.rss import parse_rss
from research_reports.collector.news_queries import RSSSourceConfig
from research_reports.database import create_database
from research_reports.models import ContentSource, NewsItem
from research_reports.services import news_collection
from research_reports.services.news_collection import collect_public_news
from sqlalchemy import select, func


def test_parse_rss_extracts_news_items_and_skips_invalid_entries() -> None:
    xml = """<?xml version="1.0"?>
    <rss><channel>
      <item>
        <title>OpenAI releases a new model</title>
        <link>https://example.com/openai</link>
        <description>Model details and benchmarks.</description>
        <pubDate>Thu, 06 Aug 2026 08:00:00 GMT</pubDate>
        <source>Example News</source>
      </item>
      <item><title>Missing URL</title><pubDate>Thu, 06 Aug 2026 08:00:00 GMT</pubDate></item>
    </channel></rss>"""

    items = parse_rss(
        xml,
        source_id="source-1",
        now=datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc),
    )

    assert len(items) == 1
    assert items[0].title == "OpenAI releases a new model"
    assert items[0].canonical_url == "https://example.com/openai"
    assert items[0].author_or_publisher == "Example News"
    assert items[0].content_hash


def test_collect_public_news_commits_content_source_before_news_items(tmp_path: Path, monkeypatch) -> None:
    xml = """<?xml version=\"1.0\"?><rss><channel><item><title>AI event</title><link>https://x.com/post</link><description>Details</description><pubDate>Thu, 06 Aug 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
    source = RSSSourceConfig(name="Indexed X", kind="x_indexed", url="https://example.test/rss", topics=("ai", "social"))
    monkeypatch.setattr(news_collection, "default_sources", lambda: (source,))
    http = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, text=xml)))
    database = create_database(tmp_path / "reports.db")
    try:
        counts = collect_public_news(database, http=http, now=datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc))
        with database.sessions() as session:
            source_row = session.scalar(select(ContentSource).where(ContentSource.name == "Indexed X"))
            news_count = session.scalar(select(func.count()).select_from(NewsItem))
        assert counts == {"Indexed X": 1}
        assert source_row is not None
        assert news_count == 1
    finally:
        http.close()
        database.dispose()


def test_collect_public_news_deduplicates_tracking_variants_across_sources(tmp_path: Path, monkeypatch) -> None:
    xml_with_tracking = """<?xml version=\"1.0\"?><rss><channel><item><title>AI launch</title><link>https://example.com/a?utm_source=google</link><description>Details</description><pubDate>Thu, 06 Aug 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
    xml_without_tracking = """<?xml version=\"1.0\"?><rss><channel><item><title>AI launch</title><link>https://example.com/a</link><description>Details</description><pubDate>Thu, 06 Aug 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
    sources = (
        RSSSourceConfig(name="Source A", kind="news_report", url="https://example.test/a", topics=("ai",)),
        RSSSourceConfig(name="Source B", kind="news_report", url="https://example.test/b", topics=("ai",)),
    )
    monkeypatch.setattr(news_collection, "default_sources", lambda: sources)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=xml_with_tracking if request.url.path.endswith("/a") else xml_without_tracking)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    database = create_database(tmp_path / "reports.db")
    try:
        collect_public_news(database, http=http, now=datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc))
        with database.sessions() as session:
            news_count = session.scalar(select(func.count()).select_from(NewsItem))
        assert news_count == 1
    finally:
        http.close()
        database.dispose()


def test_collect_public_news_deduplicates_same_headline_across_sources(tmp_path: Path, monkeypatch) -> None:
    xml_a = """<?xml version=\"1.0\"?><rss><channel><item><title>OpenAI launches a new model</title><link>https://news-a.example/story</link><description>Same event</description><pubDate>Thu, 06 Aug 2026 08:00:00 GMT</pubDate></item></channel></rss>"""
    xml_b = """<?xml version=\"1.0\"?><rss><channel><item><title>OpenAI launches a new model</title><link>https://news-b.example/story</link><description>Same event</description><pubDate>Thu, 06 Aug 2026 08:05:00 GMT</pubDate></item></channel></rss>"""
    sources = (
        RSSSourceConfig(name="Source A", kind="news_report", url="https://example.test/a", topics=("ai",)),
        RSSSourceConfig(name="Source B", kind="news_report", url="https://example.test/b", topics=("ai",)),
    )
    monkeypatch.setattr(news_collection, "default_sources", lambda: sources)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=xml_a if request.url.path.endswith("/a") else xml_b)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    database = create_database(tmp_path / "reports.db")
    try:
        collect_public_news(database, http=http, now=datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc))
        with database.sessions() as session:
            news_count = session.scalar(select(func.count()).select_from(NewsItem))
        assert news_count == 1
    finally:
        http.close()
        database.dispose()
