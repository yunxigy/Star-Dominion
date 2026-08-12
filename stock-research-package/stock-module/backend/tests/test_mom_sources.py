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
from app.integrations.xhs_mcp import XhsMcpClient, parse_rednote_text, translate_rednote_call
from app.services.xhs_login import XhsLoginService


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
    assert [post.platform_id for post in result.posts] == ["note-2", "note-1"]
    assert all(post.platform == "xiaohongshu" for post in result.posts)


def test_xhs_source_uses_note_id_time_when_provider_omits_publish_time() -> None:
    source = XiaohongshuMomSource(
        FakeMcpClient(
            {
                "AI": {
                    "items": [
                        {
                            "title": "更早的 AI 笔记",
                            "url": "https://www.xiaohongshu.com/explore/6a6701f00000000001000001?xsec_token=old",
                        },
                        {
                            "title": "更新的 AI 笔记",
                            "url": "https://www.xiaohongshu.com/explore/6a6710000000000001000002?xsec_token=new",
                        },
                    ]
                }
            }
        ),
        keywords={"nasdaq": ["AI"]},
        clock=lambda: datetime(2026, 7, 27, 9, tzinfo=UTC),
    )

    result = source.collect()

    assert [post.platform_id for post in result.posts] == [
        "6a6710000000000001000002",
        "6a6701f00000000001000001",
    ]
    assert result.posts[0].published_at == datetime(2026, 7, 27, 8, tzinfo=UTC)


def test_xhs_client_rejects_write_tools(tmp_path) -> None:
    client = XhsMcpClient(["npx", "package"], data_dir=tmp_path)

    with pytest.raises(PermissionError):
        import asyncio

        asyncio.run(client.call("xhs_like_feed", {"note_id": "note-1"}))


def test_rednote_adapter_maps_read_tools_and_search_text() -> None:
    assert translate_rednote_call("xhs_search", {"keyword": "AI"}) == (
        "search_notes",
        {"keywords": "AI", "limit": 10},
    )
    assert translate_rednote_call("xhs_get_note", {"url": "https://www.xiaohongshu.com/explore/1"}) == (
        "get_note_content",
        {"url": "https://www.xiaohongshu.com/explore/1"},
    )
    parsed = parse_rednote_text("标题: AI 工具\n作者: Demo\n内容: 示例\n点赞: 12\n评论: 3\n链接: https://www.xiaohongshu.com/explore/1\n---")
    assert parsed == [{
        "title": "AI 工具",
        "author": "Demo",
        "content": "示例",
        "likes": 12,
        "comments": 3,
        "url": "https://www.xiaohongshu.com/explore/1",
    }]
    timed = parse_rednote_text(
        "标题: AI 工具\n发布时间：2026-08-12T10:00:00+08:00\n---"
    )
    assert timed == [{
        "title": "AI 工具",
        "publish_time": "2026-08-12T10:00:00+08:00",
    }]


def test_xhs_status_degrades_to_unavailable_instead_of_http_500() -> None:
    class FailingClient:
        async def call(self, tool: str, arguments: dict) -> dict:
            raise RuntimeError("MCP connection closed")

    import asyncio

    result = asyncio.run(XhsLoginService(FailingClient()).status())
    assert result["status"] == "unavailable"
    assert result["authenticated"] is False


def test_xhs_login_start_and_poll_degrade_to_readable_status() -> None:
    class FailingClient:
        async def call(self, tool: str, arguments: dict) -> dict:
            raise RuntimeError("MCP connection closed")

    import asyncio

    service = XhsLoginService(FailingClient())
    start = asyncio.run(service.start())
    poll = asyncio.run(service.poll("session-1"))
    assert start["status"] == "unavailable"
    assert poll["status"] == "unavailable"


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
