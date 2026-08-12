from research_reports.collector.ai_github import classify_trending_rows
from research_reports.collector.types import TrendingRepository


def test_classify_trending_rows_deduplicates_repositories() -> None:
    rows = [
        TrendingRepository(
            category="all",
            rank=1,
            full_name="openai/agent-skill",
            description="An MCP agent skill server",
            primary_language="Python",
            stars_total=100,
            forks_total=10,
            stars_since_weekly=20,
            contributor_urls=(),
            html_url="https://github.com/openai/agent-skill",
        ),
        TrendingRepository(
            category="python",
            rank=2,
            full_name="OpenAI/Agent-Skill",
            description="An MCP agent skill server",
            primary_language="Python",
            stars_total=100,
            forks_total=10,
            stars_since_weekly=20,
            contributor_urls=(),
            html_url="https://github.com/openai/agent-skill",
        ),
    ]

    catalog = classify_trending_rows(rows)

    assert len(catalog["mcp"]) == 1
    assert catalog["mcp"][0][0].full_name == "openai/agent-skill"
