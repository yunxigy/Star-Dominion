from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from tools.foreshadowing_manager import ForeshadowingDAGManager
from tools.init_project import init_project
from tools.rolling_planning import RollingPlanningError, RollingPlanningService
from tools.runtime_diagnostics import RuntimeDiagnosticsService
from tools.task_store import TaskStore
from tools.truth_manager import TruthFilesManager


def _outline() -> str:
    return """# 第一卷 起航

## 第一幕

### 第一节

#### 第一章

建立冲突。

#### 第二章

推进线索。
"""


def test_diagnostics_detects_stuck_failures_exhaustion_hooks_and_context(
    tmp_path: Path,
) -> None:
    init_project(tmp_path, "demo")
    novel_root = tmp_path / "data" / "novels" / "demo"
    (novel_root / "src" / "outline.md").write_text(_outline(), encoding="utf-8")
    manuscript = novel_root / "data" / "manuscript" / "arc_001"
    manuscript.mkdir(parents=True, exist_ok=True)
    for number in range(1, 13):
        (manuscript / f"ch_{number:03d}.md").write_text(
            f"# 第{number}章\n\nSECRET-BODY-{number}\n",
            encoding="utf-8",
        )

    tasks = TaskStore(tmp_path, "demo")
    stuck = tasks.create("chapter_write", {"chapter_id": "ch_013"})
    tasks.transition(stuck["task_id"], status="running", phase="model")
    record = tasks.load(stuck["task_id"])
    assert record is not None
    record["updated_at"] = (
        datetime.now(timezone.utc) - timedelta(hours=2)
    ).isoformat()
    tasks._save_unlocked(record)
    for _ in range(2):
        failed = tasks.create("chapter_review", {"chapter_id": "ch_012"})
        tasks.transition(failed["task_id"], status="failed", phase="complete")

    hooks = ForeshadowingDAGManager(tmp_path, "demo")
    hooks.create_node(
        node_id="hook_old",
        content="旧钟楼的密门",
        weight=8,
        layer="主线",
        created_at="ch_001",
        target_chapter="ch_020",
    )

    report = RuntimeDiagnosticsService(tmp_path, "demo").run(stuck_minutes=30)
    codes = {item.code for item in report.findings}
    assert {
        "stuck_task",
        "repeated_task_failure",
        "outline_window_exhausted",
        "foreshadowing_stalled",
    }.issubset(codes)
    assert all(item.evidence and item.action.action for item in report.findings)
    serialized = report.model_dump_json()
    assert "SECRET-BODY" not in serialized
    assert str(tmp_path) not in serialized


def test_diagnostics_does_not_rebuild_semantic_index_for_workspace_checks(
    tmp_path: Path,
) -> None:
    init_project(tmp_path, "demo")
    novel_root = tmp_path / "data" / "novels" / "demo"
    (novel_root / "src" / "outline.md").write_text(_outline(), encoding="utf-8")

    from tools.context_builder import ContextBuilder

    original_semantic_references = ContextBuilder._get_semantic_references

    def guarded_semantic_references(builder, *args, **kwargs):
        assert builder.semantic_context_enabled is False
        return original_semantic_references(builder, *args, **kwargs)

    with patch(
        "tools.outline_tree.build_outline_structure",
        return_value={"recommendation": {"chapter_id": "ch_001"}},
    ), patch.object(ContextBuilder, "_get_semantic_references", guarded_semantic_references):
        report = RuntimeDiagnosticsService(tmp_path, "demo").run(stuck_minutes=30)

    assert report.novel_id == "demo"
    assert "context_build_failed" not in {item.code for item in report.findings}


def test_rolling_candidate_stages_only_draft_and_rejects_stale_facts(
    tmp_path: Path,
) -> None:
    init_project(tmp_path, "demo")
    novel_root = tmp_path / "data" / "novels" / "demo"
    outline_path = novel_root / "src" / "outline.md"
    outline_path.write_text(_outline(), encoding="utf-8")
    original = outline_path.read_text(encoding="utf-8")
    service = RollingPlanningService(tmp_path, "demo")
    candidate = service.create(window_size=2)
    revision = service.revision(candidate)
    proposal = original + "\n#### 第三章\n\n进入下一窗口。\n"

    staged = service.stage_proposal(
        candidate.candidate_id,
        proposal,
        candidate_revision=revision,
    )
    assert staged.state == "proposed"
    assert outline_path.read_text(encoding="utf-8") == original
    assert (
        novel_root / "data" / "planning" / "outline_draft.md"
    ).read_text(encoding="utf-8") == proposal.rstrip()

    stale = service.create(window_size=2)
    manager = TruthFilesManager(tmp_path, "demo")
    manager.apply_runtime_delta(
        {
            "chapter_id": "ch_001",
            "source_revision": manager.load_runtime_state().revision,
            "operations": [
                {
                    "op": "append",
                    "collection": "current_state",
                    "value": {
                        "id": "fact_new",
                        "text": "事实变化",
                        "source_chapter": "ch_001",
                    },
                }
            ],
        }
    )
    with pytest.raises(RollingPlanningError) as error:
        service.stage_proposal(
            stale.candidate_id,
            proposal,
            candidate_revision=service.revision(stale),
        )
    assert error.value.code == "STALE_CANDIDATE_INPUT"
    loaded = service.load(stale.candidate_id)
    assert loaded is not None and loaded.state == "stale"
