from datetime import datetime, timezone

from research_reports.ai_client import AICompletion
from research_reports.collector.rss import RSSItem
from research_reports.services.briefings import BriefingService


class FakeAI:
    def generate(self, *, system: str, user: str) -> AICompletion:
        assert "source_id" in user
        return AICompletion(text='{"title":"AI早报","summary":"摘要","events":[{"source_id":"n1","title":"事件"}],"risks":[],"source_ids":["n1"]}', model="deepseek-v4-flash")


def test_briefing_service_validates_source_ids() -> None:
    item = RSSItem("source", "https://example.com", "AI event", "Summary", datetime.now(timezone.utc), "News", "n1")
    result = BriefingService(ai_client=FakeAI()).generate([item], now=datetime(2026, 8, 6, 9, 0, tzinfo=timezone.utc))
    assert result.title == "AI早报"
    assert result.source_ids == ("n1",)
    assert result.status == "success"
