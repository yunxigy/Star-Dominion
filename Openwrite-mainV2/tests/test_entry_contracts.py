from http import HTTPStatus
from pathlib import Path

import pytest

import tools.chapter_pipeline as chapter_pipeline_module
from tools.agent.book_state import BookStateStore
from tools.agent.tool_layers import build_goethe_tool_layers
from tools.agent.tool_runtime import build_tool_executors
from tools.init_project import init_project
from tools.model_profiles import ModelProfileStore
from tools.novel_service import NovelApplicationService, NovelServiceError
from tools.source_pack import SourcePackService
from tools.story_planning import StoryPlanningStore
from tools.studio import StudioApplication
from tools.studio_preferences import StudioModelSettingsStore


def test_agent_and_studio_project_the_same_canonical_packet(tmp_path: Path):
    init_project(tmp_path, "demo", "统一上下文")
    service = NovelApplicationService(tmp_path)
    studio = StudioApplication(tmp_path)
    tools = build_tool_executors(tmp_path)

    canonical = service.context_preview("ch_001")
    studio_preview = studio.context_preview("ch_001")
    agent_preview = tools["get_context"]({"chapter_id": "ch_001"})

    assert agent_preview["context_packet"] == canonical["packet"]
    assert studio_preview["markdown"] == canonical["markdown"]
    assert agent_preview["target_words"] == studio_preview["target_words"]


def test_studio_and_agent_write_send_identical_normalized_payload(
    tmp_path: Path, monkeypatch
):
    init_project(tmp_path, "demo", "统一写章")
    monkeypatch.setenv("LLM_API_KEY", "test-only")
    monkeypatch.delenv("LLM_MAX_TOKENS", raising=False)
    monkeypatch.delenv("OPENWRITE_CONTEXT_TOKENS", raising=False)
    calls: list[dict] = []

    def fake_pipeline(root: Path, args: dict) -> dict:
        calls.append(args)
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "title": "第一章",
            "word_count": 800,
            "draft_path": str(root / "ch_001.md"),
            "truth_updates": {},
        }

    monkeypatch.setattr(
        chapter_pipeline_module,
        "execute_write_chapter",
        fake_pipeline,
    )
    preferences = StudioModelSettingsStore(tmp_path / "model-settings")
    studio = StudioApplication(
        tmp_path,
        model_settings_store=preferences,
        model_profile_store=ModelProfileStore(preferences.directory),
    )
    tools = build_tool_executors(tmp_path)
    studio.write_next_chapter(
        {"target_words": 800, "guidance": "雨夜开场", "temperature": 0.6}
    )
    tools["write_chapter"](
        {
            "chapter_id": "next",
            "target_words": 800,
            "guidance": "雨夜开场",
            "temperature": 0.6,
        }
    )

    assert len(calls) == 2
    assert calls[0] == calls[1]
    assert calls[0]["chapter_id"] == "ch_001"
    assert calls[0]["context_packet"]["chapter_id"] == "ch_001"


def test_source_review_is_identical_in_service_studio_and_goethe(tmp_path: Path):
    init_project(tmp_path, "demo", "统一来源")
    source = SourcePackService(tmp_path, "demo")
    root = source.source_root("reference")
    (root / "style").mkdir(parents=True)
    (root / "source.md").write_text("# 来源\n\n只取可复用技法。", encoding="utf-8")

    expected = NovelApplicationService(tmp_path).review_source("reference")[
        "review_report"
    ]
    studio = StudioApplication(tmp_path).source_action(
        {"action": "review", "source_id": "reference"}
    )["result"]
    goethe_layers = build_goethe_tool_layers(tmp_path, "demo")
    goethe = goethe_layers["action_tool_executors"]["review_source_pack"](
        {"source_id": "reference"}
    )

    assert studio["review_report"] == expected
    assert goethe["review_report"] == expected
    assert goethe["review_metadata"]["promotion_ready"] is False
    assert goethe["next_action"] == "extract_style_source"


def test_goethe_reference_library_exposes_profile_navigation(
    tmp_path: Path, monkeypatch
):
    project = tmp_path / "project"
    library = tmp_path / "private-reference-library"
    init_project(project, "demo", "参考画像导航")
    monkeypatch.setenv("OPENWRITE_REFERENCE_LIBRARY_ROOT", str(library))

    result = build_goethe_tool_layers(project, "demo")["action_tool_executors"][
        "list_reference_library"
    ]({})

    assert result["ok"] is True
    assert result["references"] == []
    assert result["profiles"] == []


def test_goethe_outline_tools_stage_diff_before_confirming_src(tmp_path: Path):
    init_project(tmp_path, "demo", "增量大纲")
    layers = build_goethe_tool_layers(tmp_path, "demo")
    actions = layers["action_tool_executors"]
    source_path = tmp_path / "data" / "novels" / "demo" / "src" / "outline.md"
    original = source_path.read_text(encoding="utf-8")

    snapshot = actions["read_outline"]({"query": "核心主题"})
    staged = actions["stage_outline_edits"](
        {
            "base_revision": snapshot["revision"],
            "edits": [
                {
                    "old_text": "核心主题: 待填写",
                    "new_text": "核心主题: 记忆与代价",
                }
            ],
        }
    )

    assert staged["ok"] is True
    assert staged["action"] == "stage_outline_edits"
    assert "+> 核心主题: 记忆与代价" in staged["diff"]
    assert source_path.read_text(encoding="utf-8") == original

    confirmed = actions["confirm_outline_edits"]({})

    assert confirmed["ok"] is True
    assert confirmed["action"] == "confirm_outline_edits"
    assert "核心主题: 记忆与代价" in source_path.read_text(encoding="utf-8")


def test_goethe_generic_outline_read_is_redirected_to_pending_draft(tmp_path: Path):
    init_project(tmp_path, "demo", "待确认大纲读取")
    layers = build_goethe_tool_layers(tmp_path, "demo")
    actions = layers["action_tool_executors"]
    source_path = tmp_path / "data" / "novels" / "demo" / "src" / "outline.md"
    original = source_path.read_text(encoding="utf-8")
    snapshot = actions["read_outline"]({"query": "核心主题"})
    staged = actions["stage_outline_edits"](
        {
            "base_revision": snapshot["revision"],
            "edits": [
                {
                    "old_text": "核心主题: 待填写",
                    "new_text": "核心主题: 待确认版本",
                }
            ],
            "final_batch": False,
        }
    )
    assert staged["ok"] is True

    redirected = layers["direct_tool_executors"]["read_project_document"](
        {"path": "src/outline.md"}
    )

    assert redirected["ok"] is True
    assert redirected["redirected_from"] == "read_project_document"
    assert redirected["source_kind"] == "pending_draft"
    assert redirected["revision"] == staged["draft_revision"]
    assert "核心主题: 待确认版本" in redirected["content"]
    assert source_path.read_text(encoding="utf-8") == original


def test_goethe_exposes_persistent_ideation_summary_confirmation(tmp_path: Path):
    init_project(tmp_path, "demo", "汇总确认")
    layers = build_goethe_tool_layers(tmp_path, "demo")
    actions = layers["action_tool_executors"]
    planning = StoryPlanningStore(tmp_path, "demo")
    planning.append_ideation("主角能听见旧唱片里的记忆")
    planning.save_ideation_summary("# 当前想法汇总\n\n- 音乐悬疑成长故事\n")
    state_store = BookStateStore(tmp_path, "demo")
    state = state_store.load_or_create()
    state.pending_confirmation = "ideation_summary"
    state_store.save(state)

    result = actions["confirm_ideation_summary"]({"text": "确认这版汇总"})

    assert "confirm_ideation_summary" in layers["action_toolkit"]
    assert result["action"] == "confirm_ideation_summary"
    assert result["blocked"] is False
    assert state_store.load_or_create().pending_confirmation != "ideation_summary"


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("INVALID_INPUT", HTTPStatus.BAD_REQUEST),
        ("CONFLICT", HTTPStatus.CONFLICT),
        ("PROJECT_BUSY", HTTPStatus.CONFLICT),
        ("NOT_FOUND", HTTPStatus.NOT_FOUND),
        ("INVALID_PROJECT", HTTPStatus.PRECONDITION_FAILED),
        ("OPERATION_FAILED", HTTPStatus.BAD_GATEWAY),
    ],
)
def test_service_error_codes_have_one_studio_http_contract(code: str, status: int):
    translated = StudioApplication._translate_service_error(
        NovelServiceError("failure", code=code)
    )

    assert translated.status == status
