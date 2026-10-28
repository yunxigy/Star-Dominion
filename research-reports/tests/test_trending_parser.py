from pathlib import Path

import pytest

from research_reports.collector.parser import TrendingParseError, parse_trending


FIXTURE = Path(__file__).parent / "fixtures" / "trending_weekly.html"


def test_parse_weekly_trending_rows() -> None:
    rows = parse_trending(FIXTURE.read_text(encoding="utf-8"), category="python")

    assert [row.rank for row in rows] == [1, 2]
    assert rows[0].full_name == "owner/alpha"
    assert rows[0].stars_total == 1234
    assert rows[0].forks_total == 89
    assert rows[0].stars_since_weekly == 456
    assert rows[0].category == "python"
    assert rows[0].contributor_urls == ("https://avatars.githubusercontent.com/u/1?v=4",)
    assert rows[1].description is None
    assert rows[1].primary_language is None


def test_empty_trending_page_is_rejected() -> None:
    with pytest.raises(TrendingParseError, match="no repository rows"):
        parse_trending("<html></html>", category="all")


def test_invalid_repository_path_is_rejected() -> None:
    html = '<article class="Box-row"><h2><a href="/only-owner">broken</a></h2></article>'
    with pytest.raises(TrendingParseError, match="no repository rows"):
        parse_trending(html, category="all")
