from __future__ import annotations

from pathlib import Path

from tools.context_builder import ContextBuilder
from tools.novel_service import NovelApplicationService
from tools.novel_workspace import list_chapters
from tools.source_sync import collect_sync_status


def test_realistic_fixture_is_ready_for_chapter_seven(live_project: Path):
    status = collect_sync_status(live_project, "mujianzhe")
    assert status["needs_sync"] is False

    chapters = list_chapters(live_project, "mujianzhe")
    assert [item.chapter_id for item in chapters] == [f"ch_{index:03d}" for index in range(1, 7)]

    context = ContextBuilder(live_project, "mujianzhe").build_generation_context("ch_007")
    assert context.current_chapter is not None
    assert context.current_chapter.node_id == "ch_007"
    assert context.target_words == 3200
    assert "长期不变" in context.author_intent or "核心承诺" in context.author_intent
    assert "完成第 7 章" in context.creative_focus
    assert "M.O." in context.current_state
    assert "回响残页" in context.ledger
    assert "白续" in context.relationships
    assert "ch_006" in context.chapter_summaries
    assert "沉默的前辈" in context.chapter_summaries

    active_names = {item.name for item in context.active_characters}
    assert {"沈烬", "刑无咎", "顾衡"}.issubset(active_names)
    pending_ids = {str(item.get("id")) for item in context.foreshadowing.pending}
    planted_ids = {str(item.get("id")) for item in context.foreshadowing.planted}
    assert {"echo_sabotage", "wanshi_purchase"}.issubset(pending_ids)
    assert {"key_bracelet_origin", "m_o_identity"}.issubset(planted_ids)
    assert context.estimate_tokens() <= context.compression["budget_tokens"]


def test_canonical_packet_contains_long_form_context(live_project: Path):
    preview = NovelApplicationService(live_project).context_preview("ch_007")
    packet = preview["packet"]

    assert preview["chapter_id"] == "ch_007"
    assert preview["target_words"] == 3200
    assert "等待着下一次被惊醒的时机" in packet["previous_chapter_content"]
    assert "（第六章完）" in packet["previous_chapter_content"]
    assert packet["author_intent"]
    assert packet["creative_focus"]
    assert packet["current_state"]
    assert packet["ledger"]
    assert packet["relationships"]
    assert {"沈烬", "刑无咎", "顾衡"}.issubset(packet["character_documents"])
    manifest_sections = {
        item["section"] for item in packet["context_manifest"]["items"]
    }
    assert {"author_intent", "creative_focus", "previous_chapter_content"}.issubset(
        manifest_sections
    )
    assert packet["compression"]["final_characters"] <= packet["compression"]["original_characters"]
