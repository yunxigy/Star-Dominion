from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_chat_frontend_exposes_branch_and_message_controls():
    html = (ROOT / "frontend" / "index.html").read_text("utf-8")
    app = (ROOT / "frontend" / "js" / "app.js").read_text("utf-8")

    for marker in (
        "chat-session-panel",
        "chat-search-input",
        "branch-select",
        "checkpoint-list",
        "chat-backup-file",
    ):
        assert marker in html
    for function_name in (
        "editChatMessage",
        "deleteChatMessage",
        "activateChatBranch",
        "createChatCheckpoint",
        "restoreChatCheckpoint",
        "searchChats",
        "exportChatBackup",
        "importChatBackup",
    ):
        assert (
            f"function {function_name}" in app
            or f"async function {function_name}" in app
        )


def test_chat_frontend_uses_cookie_api_for_all_mutations():
    api = (ROOT / "frontend" / "js" / "api.js").read_text("utf-8")
    app = (ROOT / "frontend" / "js" / "app.js").read_text("utf-8")

    assert "async patch(endpoint, body)" in api
    assert "async del(endpoint, body)" in api
    assert "Authorization" not in app
    assert "Bearer" not in app


def test_chat_frontend_restores_server_message_metadata():
    app = (ROOT / "frontend" / "js" / "app.js").read_text("utf-8")

    assert "msg.id" in app
    assert "msg.swipes" in app
    assert "msg.swipe_id" in app
    assert "msg.parent_message_id" in app
