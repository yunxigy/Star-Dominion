import json
from pathlib import Path

import pytest

from tools.agent.book_state import BookStage, BookStateStore
from tools.cli import _save_chapter
from tools.project_registry import ProjectRegistry
from tools.studio import StudioApplication, StudioError
from tools.studio_preferences import StudioModelSettingsStore


def test_studio_end_to_end_novel_crud_lifecycle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    project_root = tmp_path / "novel_project"
    writer_calls: list[dict] = []
    review_calls: list[dict] = []

    def writer(root: Path, args: dict) -> dict:
        writer_calls.append(args)
        chapter_id = str(args["chapter_id"])
        title = "第一章：钟声少了一拍"
        path = _save_chapter(
            root,
            "e2e_novel",
            chapter_id,
            title,
            "林舟在钟楼听见少掉的一拍，钥匙在掌心发热。",
        )
        return {
            "ok": True,
            "chapter_id": chapter_id,
            "title": title,
            "word_count": 24,
            "draft_path": str(path),
            "truth_updates": {"current_state": "林舟获得钟楼钥匙。"},
        }

    def reviewer(root: Path, args: dict) -> dict:
        review_calls.append(args)
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "passed": True,
            "score": 91,
            "issues": 0,
            "summary": "节奏清晰，可以进入下一章。",
            "issue_details": [],
        }

    app = StudioApplication(
        project_root,
        writer_executor=writer,
        review_executor=reviewer,
        project_registry=ProjectRegistry(
            tmp_path / "recent.yaml", allow_ephemeral=True
        ),
        model_settings_store=StudioModelSettingsStore(tmp_path / "studio-settings"),
    )

    workspace = app.initialize_project(
        {
            "novel_id": "e2e_novel",
            "title": "地下星图",
        }
    )
    assert workspace["initialized"] is True
    assert workspace["snapshot"]["title"] == "地下星图"

    configured = app.configure_model(
        {
            "provider": "openai",
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-v4-flash",
            "api_key": "e2e-secret",
            "api_format": "chat",
            "context_tokens": 160000,
            "max_tokens": 24000,
            "remember_api_key": False,
        }
    )
    assert configured["model"]["configured"] is True
    assert configured["model"]["persistence"]["credential_saved"] is False
    assert "e2e-secret" not in json.dumps(configured)

    character = app.create_document(
        {
            "kind": "character",
            "name": "林舟",
            "description": "钟楼修复师，能听见缺失的时间。",
        }
    )["document"]
    world = app.create_document(
        {
            "kind": "world",
            "name": "旧钟楼",
            "description": "城中所有失踪时间都会回流到这里。",
        }
    )["document"]
    character_doc = app.read_document(character["path"])
    saved_character = app.write_document(
        character_doc["path"],
        character_doc["content"] + "\n关系：与旧钟楼互相牵制。\n",
        character_doc["version"],
    )
    assert "互相牵制" in saved_character["content"]
    assert app.search_project("旧钟楼", "all")["results"]

    background = app.read_document("src/story/background.md")
    app.write_document(
        "src/story/background.md",
        "# 故事背景\n\n地下星图每晚改写一次城市道路。\n",
        background["version"],
    )
    focus = app.update_focus(
        {
            "goal": "推进第一篇到揭开钟楼钥匙真相",
            "must_keep": ["悬疑感", "现实质感"],
            "must_avoid": ["提前解释终局"],
            "notes": ["第一章只展示异常，不解释原理"],
        }
    )
    assert focus["snapshot"]["creative_focus"]["goal"].startswith("推进第一篇")

    outline_doc = app.read_document("src/outline.md")
    outline_content = """# 第一卷：钥匙

## 第一幕：回声

### 第一节：钟楼

这一节让林舟发现时间缺口。

#### 第一章：钟声少了一拍

林舟修复旧钟时，发现城市时间少了一拍。

#### 第二章：镜厅追踪

他沿着回声进入镜厅。
"""
    app.write_document("src/outline.md", outline_content, outline_doc["version"])
    outline = app.outline_structure()
    assert outline["counts"]["chapter"] == 2

    added = app.edit_outline_structure(
        {
            "operation": "add_child",
            "node_id": "section_001",
            "kind": "chapter",
            "title": "第三章：地下门",
            "revision": outline["revision"],
        }
    )
    assert added["outline"]["counts"]["chapter"] == 3
    summarized = app.edit_outline_structure(
        {
            "operation": "update_summary",
            "node_id": "section_001",
            "summary": "这一节聚焦林舟、旧钟楼与地下门的连续线索。",
            "revision": added["outline"]["revision"],
        }
    )
    assert summarized["selected_node_id"] == "section_001"
    renamed = app.edit_outline_structure(
        {
            "operation": "rename",
            "node_id": "volume_001",
            "title": "第一卷：失时钥匙",
            "revision": summarized["outline"]["revision"],
        }
    )
    deleted = app.edit_outline_structure(
        {
            "operation": "delete",
            "node_id": "ch_002",
            "revision": renamed["outline"]["revision"],
        }
    )
    assert [(item["old_id"], item["new_id"]) for item in deleted["renumbered"]] == [
        ("ch_003", "ch_002"),
    ]
    source = app.read_document("src/outline.md")["content"]
    assert "第一卷：失时钥匙" in source
    assert "镜厅追踪" not in source
    assert "第二章：地下门" in source

    preview = app.context_preview("ch_001")
    assert preview["chapter_id"] == "ch_001"
    assert preview["manifest"]["strategy"] == "hierarchical-provenance-v1"
    write_result = app.write_next_chapter(
        {
            "chapter_id": "ch_001",
            "outline_revision": deleted["outline"]["revision"],
            "guidance": "保持悬疑，不解释地下门来源。",
            "target_words": 800,
        }
    )
    assert write_result["result"]["chapter_id"] == "ch_001"
    assert writer_calls[0]["context_packet"]["chapter_id"] == "ch_001"
    assert writer_calls[0]["target_words"] == 800
    with pytest.raises(StudioError, match="不能删除"):
        app.edit_outline_structure(
            {
                "operation": "delete",
                "node_id": "section_001",
                "revision": app.outline_structure()["revision"],
            }
        )

    review = app.review_chapter({"path": "data/manuscript/arc_001/ch_001.md"})
    assert review["result"]["score"] == 91
    assert review_calls == [
        {"chapter_id": "ch_001", "strict": False, "dimensions": None}
    ]
    assert (
        BookStateStore(project_root, "e2e_novel").load_or_create().stage
        == BookStage.CHAPTER_PREFLIGHT
    )

    created_hook = app.manage_foreshadowing(
        {
            "action": "create",
            "node_id": "hook_clock_key",
            "content": "钥匙会在整点前发热",
            "weight": 8,
            "created_at": "ch_001",
            "target_chapter": "ch_002",
        }
    )
    assert created_hook["continuity"]["foreshadowing"]["nodes"][0]["id"] == "hook_clock_key"
    resolved_hook = app.manage_foreshadowing(
        {
            "action": "update",
            "node_id": "hook_clock_key",
            "status": "resolved",
        }
    )
    assert resolved_hook["result"]["status"] == "resolved"
    continuity = app.continuity()
    assert continuity["workflows"][0]["chapter_id"] == "ch_001"
    assert continuity["foreshadowing_validation"]["valid"] is True

    imported = app.import_text(
        {
            "filename": "late_arc.md",
            "arc_id": "arc_002",
            "start_number": 5,
            "content": "第五章：后期回响\n\n地下门在第五章重新开启。",
        }
    )
    assert imported["imported"][0]["chapter_id"] == "ch_005"
    assert app.search_project("重新开启", "chapters")["results"]

    filename, markdown, mime = app.export_download("md")
    assert filename == "e2e_novel.md"
    assert mime == "text/markdown; charset=utf-8"
    assert "地下星图" in markdown.decode("utf-8")
    assert "第五章：后期回响" in markdown.decode("utf-8")
    assert world["path"] in {
        item["path"] for item in app.workspace()["documents"]["settings"]
    }
