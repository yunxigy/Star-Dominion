from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_persona_page_uses_private_api_and_safe_rendering():
    page = (ROOT / "frontend" / "personas.html").read_text("utf-8")
    script = (ROOT / "frontend" / "js" / "personas.js").read_text("utf-8")
    assert "js/auth.js" in page and "js/api.js" in page
    assert "/api/personas" in script
    assert "textContent" in script and "innerHTML" not in script


def test_prompt_manager_exposes_blocks_profiles_and_preview():
    page = (ROOT / "frontend" / "prompt-manager.html").read_text("utf-8")
    script = (ROOT / "frontend" / "js" / "prompt-manager.js").read_text("utf-8")
    for control in ("preset-list", "block-list", "model-profile-list", "prompt-preview", "preview-trace"):
        assert f'id="{control}"' in page
    assert "/api/prompt-presets/preview" in script
    assert "/blocks/reorder" in script
    assert "API.put(`/api/prompt-presets/blocks/" in script
    assert "API.del(`/api/prompt-presets/blocks/" in script
    assert 'id="block-enabled"' in page
    assert 'id="block-order"' in page
    assert "textContent" in script and "innerHTML" not in script
