from __future__ import annotations

from pathlib import Path

from live_tests.conftest import require_live_tier
from tools.agent.book_state import BookStage, BookStateStore
from tools.agent.dante import DanteChatAgent
from tools.goethe import GoetheChatAgent
from tools.story_planning import StoryPlanningStore

MUTATING_TOOLS = {
    "create_character",
    "edit_project_document",
    "edit_world_relation",
    "edit_world_relations",
    "edit_outline_structure",
    "stage_outline_edits",
    "confirm_outline_edits",
    "delegate_chapter_write",
}


def _tool_names(activity: list[dict]) -> list[str]:
    return [
        str(item.get("tool") or "")
        for item in activity
        if item.get("event") == "tool_started"
    ]


def test_goethe_reads_outline_without_mutating(live_project: Path, live_env, write_artifact):
    require_live_tier("agent")
    activity: list[dict] = []
    agent = GoetheChatAgent(
        live_project,
        "mujianzhe",
        activity_callback=activity.append,
    )
    reply = agent.respond(
        "这是只读诊断。必须先调用 get_outline_structure 查看 ch_007 的位置，"
        "再用不超过五句话说明它如何承接第六章。不要调用任何编辑、生成或确认工具。"
    )
    calls = _tool_names(activity)
    write_artifact("goethe_read_only.json", {"reply": reply, "activity": activity})

    assert reply
    assert "get_outline_structure" in calls
    assert MUTATING_TOOLS.isdisjoint(calls)


def test_dante_reads_canonical_context_without_writing(
    live_project: Path, live_env, write_artifact
):
    require_live_tier("agent")
    activity: list[dict] = []
    agent = DanteChatAgent(
        live_project,
        "mujianzhe",
        activity_callback=activity.append,
    )
    reply = agent.respond(
        "这是只读诊断。必须调用 get_context，chapter_id 设为 ch_007。"
        "随后列出作者意图、创作罗盘、前章衔接、真相文件、伏笔这五类上下文是否齐全。"
        "不要写章、审稿或修改任何文件。"
    )
    calls = _tool_names(activity)
    write_artifact("dante_context_read.json", {"reply": reply, "activity": activity})

    assert reply
    assert "get_context" in calls
    assert MUTATING_TOOLS.isdisjoint(calls)


def test_goethe_confirms_ideation_and_generates_outline_in_one_turn(
    live_project: Path,
    live_env,
    write_artifact,
):
    require_live_tier("agent")
    planning = StoryPlanningStore(live_project, "mujianzhe")
    planning.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
    planning.ideation_path.write_text(
        "主角是一名能听见旧唱片记忆的落魄歌手。\n",
        encoding="utf-8",
    )
    planning.save_ideation_summary(
        "# 当前想法汇总\n\n"
        "## 核心方向\n\n"
        "- 音乐悬疑成长故事\n"
        "- 主角通过旧唱片追查一桩被遗忘的失踪案\n"
    )
    planning.story_src_dir.mkdir(parents=True, exist_ok=True)
    (planning.story_src_dir / "foundation.md").write_text(
        "# 基础设定\n\n## 核心机制\n\n（待填写）\n",
        encoding="utf-8",
    )
    planning.outline_src_path.write_text(
        "# 测试大纲\n\n"
        "> 核心主题: 待填写\n"
        "> 故事简介: 待填写\n\n"
        "## 第一篇\n\n"
        "### 第一节\n\n"
        "#### 第一章\n\n"
        "> 内容焦点: 待填写\n",
        encoding="utf-8",
    )
    state_store = BookStateStore(live_project, "mujianzhe")
    state = state_store.load_or_create()
    state.stage = BookStage.DISCOVERY
    state.pending_confirmation = "ideation_summary"
    state.blocking_reason = ""
    state.last_agent_action = "generated_ideation_summary"
    state_store.save(state)

    activity: list[dict] = []
    agent = GoetheChatAgent(
        live_project,
        "mujianzhe",
        activity_callback=activity.append,
    )
    reply = agent.respond("确认汇总了，生成大纲草案吧")
    calls = _tool_names(activity)
    outline_tool_results = [
        item
        for item in activity
        if item.get("event") == "tool_completed"
        and item.get("tool") == "generate_outline_draft"
    ]
    persisted = state_store.load_or_create()
    write_artifact(
        "goethe_confirm_ideation_and_outline.json",
        {
            "reply": reply,
            "activity": activity,
            "state": persisted,
            "outline_draft_exists": planning.outline_draft_path.is_file(),
        },
    )

    assert reply
    assert "连续失败" not in reply
    assert "confirm_ideation_summary" in calls
    assert all(item.get("ok") is not False for item in outline_tool_results)
    assert persisted.stage == BookStage.ROLLING_OUTLINE
    assert persisted.pending_confirmation == "outline_scope"
    assert planning.outline_draft_path.is_file()
    assert "音乐悬疑成长故事" in (
        planning.story_src_dir / "foundation.md"
    ).read_text(encoding="utf-8")
