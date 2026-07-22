from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.services.news_window import NewsSeed, build_important_news, trading_news_window


CN = ZoneInfo("Asia/Shanghai")


def test_window_uses_previous_market_date_and_never_reaches_future() -> None:
    now = datetime(2026, 7, 22, 8, 10, tzinfo=CN)

    start, end = trading_news_window(
        report_date=date(2026, 7, 22),
        previous_trade_date=date(2026, 7, 21),
        now=now,
    )

    assert start == datetime(2026, 7, 21, 15, 0, tzinfo=CN)
    assert end == now


def test_window_caps_at_open_after_0930() -> None:
    start, end = trading_news_window(
        report_date=date(2026, 7, 22),
        previous_trade_date=date(2026, 7, 21),
        now=datetime(2026, 7, 22, 11, 0, tzinfo=CN),
    )

    assert start == datetime(2026, 7, 21, 15, 0, tzinfo=CN)
    assert end == datetime(2026, 7, 22, 9, 30, tzinfo=CN)


def test_news_is_filtered_deduplicated_and_ranked() -> None:
    items = build_important_news(
        seeds=[
            NewsSeed(
                title="许继电气中标重大项目",
                published_at="2026-07-21 20:10",
                source="公司公告",
                url="https://example.test/one",
                symbol="000400",
                theme="电网",
                theme_score=82,
            ),
            NewsSeed(
                title="许继电气 中标重大项目！",
                published_at="2026-07-21 20:11",
                source="转载",
                url="https://example.test/two",
                symbol="000400",
                theme="电网",
                theme_score=82,
            ),
            NewsSeed(
                title="开盘后消息",
                published_at="2026-07-22 10:00",
                source="财经媒体",
                url="https://example.test/late",
                symbol="600050",
                theme="算力",
                theme_score=90,
            ),
        ],
        start=datetime(2026, 7, 21, 15, 0, tzinfo=CN),
        end=datetime(2026, 7, 22, 9, 30, tzinfo=CN),
    )

    assert [item.title for item in items] == ["许继电气中标重大项目"]
    assert items[0].symbols == ["000400"]
    assert items[0].themes == ["电网"]
    assert items[0].tone == "positive"
    assert items[0].importance_score > 0


def test_news_with_missing_or_invalid_time_is_not_invented() -> None:
    items = build_important_news(
        seeds=[
            NewsSeed(title="没有时间", published_at="", source="公司公告"),
            NewsSeed(title="错误时间", published_at="not-a-date", source="公司公告"),
        ],
        start=datetime(2026, 7, 21, 15, 0, tzinfo=CN),
        end=datetime(2026, 7, 22, 9, 30, tzinfo=CN),
    )

    assert items == []


def test_news_deduplication_merges_symbols_and_themes() -> None:
    items = build_important_news(
        seeds=[
            NewsSeed(
                title="产业链签署合作协议",
                published_at="2026-07-21T19:00:00+08:00",
                source="公司公告",
                symbol="000400",
                theme="电网",
                theme_score=75,
            ),
            NewsSeed(
                title="产业链签署合作协议",
                published_at="2026-07-21T19:05:00+08:00",
                source="公司公告",
                symbol="600050",
                theme="算力",
                theme_score=88,
            ),
        ],
        start=datetime(2026, 7, 21, 15, 0, tzinfo=CN),
        end=datetime(2026, 7, 22, 9, 30, tzinfo=CN),
    )

    assert len(items) == 1
    assert items[0].symbols == ["000400", "600050"]
    assert items[0].themes == ["电网", "算力"]
    assert "关联 000400、600050" in items[0].summary
