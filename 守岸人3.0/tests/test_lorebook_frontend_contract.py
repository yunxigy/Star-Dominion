from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_lorebook_page_exposes_advanced_controls_and_debugger():
    page = (ROOT / "frontend" / "lorebooks.html").read_text("utf-8")
    script = (ROOT / "frontend" / "js" / "lorebooks.js").read_text("utf-8")
    for control in (
        "token-budget", "scan-depth", "recursive-scan", "sticky", "cooldown",
        "delay", "group-weight", "entry-position", "chat-bindings", "debug-input",
        "debug-trace",
    ):
        assert f'id="{control}"' in page
    assert "/api/lorebooks/debug" in script
    assert "textContent" in script
    assert "innerHTML" not in script


def test_character_page_links_to_lorebook_manager():
    page = (ROOT / "frontend" / "characters.html").read_text("utf-8")
    assert "lorebooks.html?character_id=" in page
