import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.integrations.mom_sources import (
    MomCollectedPost,
    SourceCollection,
    XiaohongshuMomSource,
    parse_eastmoney_posts,
)
from app.integrations.xhs_mcp import XhsMcpClient


class FakeMcpClient:
    def __init__(self, responses: dict) -> None:
        self.responses = responses

    async def call(self, tool: str, arguments: dict) -> dict:
        assert tool == "xhs_search"
        return self.responses.get(arguments["keyword"], {"items": []})


def test_xhs_source_deduplicates_real_notes_across_keywords() -> None:
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "xhs-search.json").read_text(encoding="utf-8")
    )
    source = XiaohongshuMomSource(
        FakeMcpClient(fixture),
        keywords={"nasdaq": ["美股怎么买", "纳指还能买吗"]},
        clock=lambda: datetime(2026, 7, 27, tzinfo=UTC),
    )

    result = source.collect()

    assert result.status.status == "ok"
    assert result.status.post_count == 2
    assert [post.platform_id for post in result.posts] == ["note-1", "note-2"]
    assert all(post.platform == "xiaohongshu" for post in result.posts)


def test_xhs_client_rejects_write_tools(tmp_path) -> None:
    client = XhsMcpClient(["npx", "package"], data_dir=tmp_path)

    with pytest.raises(PermissionError):
        import asyncio

        asyncio.run(client.call("xhs_like_feed", {"note_id": "note-1"}))


def test_parse_eastmoney_posts_returns_only_real_linked_titles() -> None:
    html = """
    <a href="/news,of159941,123.html" title="纳指还能买吗，小白求教"></a>
    <a href="/news,of159941,124.html" title="点击开始搜索"></a>
    """

    posts = parse_eastmoney_posts(
        html,
        sector_id="nasdaq",
        collected_at=datetime(2026, 7, 27, tzinfo=UTC),
    )

    assert len(posts) == 1
    assert posts[0].platform_id == "123"
    assert str(posts[0].url) == "https://guba.eastmoney.com/news,of159941,123.html"
