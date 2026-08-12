from datetime import datetime, timezone

from research_reports.collector.rss import RSSItem
from research_reports.services.news_items import rank_news_items


def test_rank_news_items_prioritizes_ai_release_and_deduplicates_urls() -> None:
    now = datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc)
    items = [
        RSSItem("source", "https://example.com/a", "OpenAI releases a new model", "Details", now, "News", "a"),
        RSSItem("source", "https://example.com/a", "OpenAI releases a new model", "Details", now, "News", "a"),
        RSSItem("source", "https://example.com/b", "AI conference schedule", "Details", now, "News", "b"),
    ]

    ranked = rank_news_items(items)

    assert len(ranked) == 2
    assert ranked[0].canonical_url == "https://example.com/a"
    assert ranked[0].importance_score > ranked[1].importance_score
