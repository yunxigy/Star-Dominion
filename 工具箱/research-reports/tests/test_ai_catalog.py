from research_reports.services.ai_catalog import classify_repository


def test_classify_ai_repository_prefers_topics_over_description() -> None:
    result = classify_repository(
        name="skill-server",
        description="A general automation tool",
        topics=["mcp", "ai-agent"],
    )

    assert result.primary_category == "mcp"
    assert "topic:mcp" in result.reasons


def test_classify_repository_penalizes_tutorial_only_projects() -> None:
    result = classify_repository(
        name="llm-course-notes",
        description="A tutorial and course for learning LLMs",
        topics=["llm", "tutorial"],
    )

    assert result.score < 5
