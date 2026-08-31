from __future__ import annotations

import os
from pathlib import Path

import yaml

from live_tests.conftest import require_live_tier
from tools.agent.book_state import BookStateStore
from tools.chapter_memory import ChapterMemoryStore
from tools.chapter_run_store import ChapterRunStore
from tools.novel_service import NovelApplicationService
from tools.review_store import ReviewStore
from tools.truth_manager import TruthFilesManager
from tools.workflow_scheduler import WorkflowScheduler


def test_real_review_of_existing_chapter(live_project: Path, live_env, write_artifact):
    require_live_tier("full")
    result = NovelApplicationService(live_project).review_chapter("ch_006")
    write_artifact("review_ch_006.json", result)

    assert result["ok"] is True
    assert isinstance(result["score"], (int, float))
    assert 0 <= result["score"] <= 100
    assert ReviewStore(live_project, "mujianzhe").load("ch_006") is not None


def test_full_chapter_seven_write_settlement_and_review(
    live_project: Path, live_env, write_artifact
):
    require_live_tier("full")
    target_words = int(os.getenv("OPENWRITE_LIVE_TARGET_WORDS", "1200"))
    service = NovelApplicationService(live_project)
    truth_manager = TruthFilesManager(live_project, "mujianzhe")
    before_truth = truth_manager.load_truth_files()
    before_snapshots = truth_manager.list_snapshots()

    try:
        write_result = service.write_chapter(
            {
                "chapter_id": "ch_007",
                "target_words": target_words,
                "temperature": 0.65,
                "guidance": (
                    "这是端到端诊断稿。严格服从现有作者意图与创作罗盘；"
                    "不要提前揭示收购者、白续或老马克的真实身份。"
                ),
            }
        )
    except Exception as exc:
        write_artifact(
            "chapter_ch_007_failure.json",
            {"stage": "write", "error_type": type(exc).__name__, "error": str(exc)},
        )
        raise
    draft_path = Path(write_result["draft_path"])
    memory = ChapterMemoryStore(live_project, "mujianzhe").load("ch_007")
    after_truth = truth_manager.load_truth_files()
    after_snapshots = truth_manager.list_snapshots()
    runtime_state = truth_manager.load_runtime_state()
    chapter_run = ChapterRunStore(live_project, "mujianzhe").latest_for_chapter(
        "ch_007", statuses={"written", "reviewed"}
    )
    actual_word_count = int(getattr(memory, "word_count", 0) or 0) if memory else 0
    if isinstance(memory, dict):
        actual_word_count = int(memory.get("word_count") or 0)
    target_deviation_ratio = (
        abs(actual_word_count - target_words) / target_words if target_words > 0 else 0
    )
    combined_truth = "\n".join(
        [after_truth.current_state, after_truth.ledger, after_truth.relationships]
    )
    baseline_markers = ["续存派", "M.O.", "蓝色印记"]
    lost_baseline_markers = [
        marker for marker in baseline_markers if marker not in combined_truth
    ]

    write_artifact(
        "chapter_ch_007_write.json",
        {
            "write": write_result,
            "memory": memory,
            "before_truth": before_truth,
            "after_truth": after_truth,
            "before_snapshots": before_snapshots,
            "after_snapshots": after_snapshots,
            "runtime_state": runtime_state.model_dump(mode="json"),
            "chapter_run": chapter_run.model_dump(mode="json") if chapter_run else None,
            "diagnostics": {
                "requested_target_words": target_words,
                "outline_target_words": 3200,
                "actual_word_count": actual_word_count,
                "target_deviation_ratio": round(target_deviation_ratio, 4),
                "within_review_tolerance": target_deviation_ratio <= 0.3,
                "lost_baseline_markers": lost_baseline_markers,
            },
            "draft": draft_path.read_text(encoding="utf-8") if draft_path.is_file() else "",
        },
    )

    assert write_result["ok"] is True
    assert draft_path.is_file()
    draft = draft_path.read_text(encoding="utf-8")
    assert len(draft) >= 500
    assert memory is not None
    assert memory["summary"]
    assert memory["word_count"] > 0
    assert len(after_snapshots) == len(before_snapshots) + 1
    assert runtime_state.revision >= 1
    assert runtime_state.source_chapter == "ch_007"
    assert not lost_baseline_markers
    assert chapter_run is not None
    assert chapter_run.effective_target_words == target_words
    assert (
        after_truth.current_state != before_truth.current_state
        or after_truth.ledger != before_truth.ledger
        or after_truth.relationships != before_truth.relationships
    )

    review_result = service.review_chapter("ch_007")
    issue_details = review_result.get("issue_details") or []
    if target_deviation_ratio > 0.3:
        assert any(
            str(item.get("category") or "") == "目标字数偏差"
            for item in issue_details
            if isinstance(item, dict)
        ), "reviewer did not report a >30% target-word deviation"
    workflow = WorkflowScheduler(live_project, "mujianzhe").load_workflow("ch_007")
    book_state = BookStateStore(live_project, "mujianzhe").load_or_create()
    persisted_memory = yaml.safe_load(
        ChapterMemoryStore(live_project, "mujianzhe").path_for("ch_007").read_text(
            encoding="utf-8"
        )
    )
    write_artifact(
        "chapter_ch_007_pipeline.json",
        {
            "write": write_result,
            "review": review_result,
            "memory": persisted_memory,
            "book_state": book_state,
            "workflow": workflow.to_dict() if workflow else None,
            "draft": draft,
            "diagnostics": {
                "requested_target_words": target_words,
                "actual_word_count": actual_word_count,
                "target_deviation_ratio": round(target_deviation_ratio, 4),
                "within_review_tolerance": target_deviation_ratio <= 0.3,
                "target_deviation_reported": any(
                    str(item.get("category") or "") == "目标字数偏差"
                    for item in issue_details
                    if isinstance(item, dict)
                ),
            },
        },
    )

    assert review_result["ok"] is True
    assert review_result["effective_target_words"] == target_words
    assert ReviewStore(live_project, "mujianzhe").load("ch_007") is not None
    assert workflow is not None
    stage_status = {item.name: item.status for item in workflow.stages}
    assert stage_status["writing"] == "completed"
    assert stage_status["review"] == "completed"
    assert book_state.current_chapter == "ch_007"
