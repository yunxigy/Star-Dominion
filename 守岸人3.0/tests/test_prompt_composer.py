from server.services.prompt_composer import PromptBlockInput, PromptComposer


def test_composer_orders_blocks_and_reports_budget_rejections():
    blocks = [
        PromptBlockInput("persona", "persona", "Persona", 20),
        PromptBlockInput("system", "system", "Rules", 0),
        PromptBlockInput("large", "history", "x" * 40, 30),
    ]
    result = PromptComposer().compose(blocks=blocks, token_budget=10)
    assert [item.id for item in result.included] == ["system", "persona"]
    assert result.trace[-1].reason == "token_budget_exceeded"


def test_preview_redacts_secret_shaped_metadata():
    block = PromptBlockInput("system", "system", "Rules", 0)
    preview = PromptComposer().preview(blocks=[block], token_budget=100, metadata={"api_key": "secret", "model": "x"})
    assert "secret" not in str(preview)
    assert preview.metadata == {"model": "x"}
