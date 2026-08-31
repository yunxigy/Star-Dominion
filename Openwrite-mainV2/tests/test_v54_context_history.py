from __future__ import annotations

from pathlib import Path

from models.outline import OutlineNode, OutlineNodeType
from tools.agent.writer import WriterAgent
from tools.chapter_memory import ChapterMemoryStore
from tools.context_builder import ContextBuilder
from tools.truth_manager import TruthFiles, TruthFilesManager


NOVEL_ID = "context_history_novel"


def _project(tmp_path: Path) -> Path:
    novel_root = tmp_path / "data" / "novels" / NOVEL_ID
    for relative in (
        Path("src"),
        Path("data") / "manuscript" / "arc_001",
        Path("data") / "foreshadowing",
        Path("data") / "style",
        Path("data") / "memory" / "chapters",
    ):
        (novel_root / relative).mkdir(parents=True, exist_ok=True)
    (tmp_path / "craft").mkdir(parents=True, exist_ok=True)
    (novel_root / "src" / "outline.md").write_text("# 测试大纲\n", encoding="utf-8")
    return tmp_path


def test_truth_history_is_scoped_to_the_requested_chapter(tmp_path: Path):
    root = _project(tmp_path)
    manager = TruthFilesManager(root, NOVEL_ID)
    manager.save_truth_files(
        TruthFiles(
            current_state="第二章已经确认的状态",
            ledger="第二章账本",
            relationships="第二章关系",
        )
    )
    manager.create_snapshot(2)
    manager.save_truth_files(
        TruthFiles(
            current_state="第120章之后的未来状态",
            ledger="未来账本",
            relationships="未来关系",
        )
    )

    historical = manager.load_truth_files_at_chapter(2)

    assert historical.current_state == "第二章已经确认的状态"
    assert historical.ledger == "第二章账本"
    assert historical.relationships == "第二章关系"
    assert historical.metadata["_source"]["kind"] == "snapshot"


def test_context_contains_memory_and_scoped_state_updates(tmp_path: Path):
    root = _project(tmp_path)
    manager = TruthFilesManager(root, NOVEL_ID)
    manager.save_truth_files(TruthFiles(current_state="历史真相"))
    manager.create_snapshot(1)
    manager.save_truth_files(TruthFiles(current_state="未来真相"))
    manager.record_chapter_update(
        "ch_001",
        {"current_state": "第一章新增：主角拿到钥匙"},
    )
    manager.record_chapter_update(
        "ch_004",
        {"current_state": "未来章节新增：不应提前出现"},
    )
    ChapterMemoryStore(root, NOVEL_ID).save(
        chapter_id="ch_001",
        title="开门",
        summary="主角在雨夜拿到钥匙。",
        word_count=1000,
    )

    context = ContextBuilder(root, NOVEL_ID).build_generation_context(
        "ch_003",
        as_of_chapter=1,
    )

    assert "ch_001《开门》" in context.chapter_summaries
    assert "主角在雨夜拿到钥匙" in context.chapter_summaries
    assert "第一章新增：主角拿到钥匙" in context.chapter_summaries
    assert "未来章节新增" not in context.chapter_summaries
    assert context.current_state == "历史真相"
    assert context.semantic_retrieval["truth_source"]["kind"] == "snapshot"


def test_recent_chapter_excerpt_keeps_head_and_tail_anchors(tmp_path: Path):
    root = _project(tmp_path)
    body = (
        "早期事实锚点：主角已经拿到旧钥匙。\n\n"
        + "中段重复动作。" * 400
        + "\n\n末尾状态锚点：钥匙在钟声响起时发热。"
    )
    chapter_path = (
        root
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "manuscript"
        / "arc_001"
        / "ch_001.md"
    )
    chapter_path.write_text(body, encoding="utf-8")

    recent = ContextBuilder(root, NOVEL_ID)._get_recent_chapters(
        "ch_002",
        limit=1,
    )

    assert "早期事实锚点" in recent
    assert "末尾状态锚点" in recent


def test_revision_prompt_contains_candidate_review_evidence_and_history():
    writer = WriterAgent.__new__(WriterAgent)
    prompt = writer._build_creative_user_prompt(
        {
            "current_state": "历史真相：钥匙仍在主角手中。",
            "revision_draft": {
                "title": "第二章",
                "content": "候选稿开头事实。候选稿结尾悬念。",
                "review": {
                    "score": 61,
                    "summary": "转折缺少具体动作。",
                },
                "issues": [
                    {
                        "severity": "critical",
                        "category": "连续性",
                        "description": "钥匙位置与上一章冲突",
                        "suggestion": "保留钥匙在主角手中",
                        "evidence": "上一章结尾",
                    }
                ],
            },
        },
        chapter_number=2,
        target_words=1000,
    )

    assert "上一版候选稿" in prompt
    assert "候选稿开头事实" in prompt
    assert "钥匙位置与上一章冲突" in prompt
    assert "上一章结尾" in prompt
    assert "历史真相：钥匙仍在主角手中" in prompt
    assert "只针对审查问题修订" in prompt


def test_reference_material_stays_out_of_truth_state(tmp_path: Path):
    root = _project(tmp_path)
    manager = TruthFilesManager(root, NOVEL_ID)
    manager.save_truth_files(TruthFiles(current_state="正典状态：钟楼仍在城中"))
    (root / "data" / "novels" / NOVEL_ID / "data" / "sources" / "reference").mkdir(
        parents=True,
        exist_ok=True,
    )

    class FakeSearchIndex:
        def search(self, query, *, scope, limit):
            del query, limit
            if scope == "chapters":
                results = []
            else:
                results = [
                    {
                        "path": "data/sources/reference/analysis_v2/report.json",
                        "title": "参考拆解",
                        "scope": "sources",
                        "retrieval": ["semantic"],
                        "excerpt": "参考作品中的错误设定：钟楼已经坍塌。",
                    }
                ]
            return {
                "engine": "test",
                "warning_code": "",
                "retrieval_stats": {"semantic": len(results)},
                "results": results,
            }

    builder = ContextBuilder(
        root,
        NOVEL_ID,
        search_index_factory=lambda novel_root: FakeSearchIndex(),
    )
    reference_text, _ = builder._get_semantic_references(
        "ch_002",
        current_chapter=OutlineNode(
            node_id="ch_002",
            node_type=OutlineNodeType.CHAPTER,
            title="钟楼回声",
            summary="调查钟楼",
        ),
        active_characters=[],
        character_states="",
    )

    assert "参考作品中的错误设定" in reference_text
    assert manager.load_truth_files().current_state == "正典状态：钟楼仍在城中"
