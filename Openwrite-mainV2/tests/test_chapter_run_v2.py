from pathlib import Path

import pytest

from tools.chapter_run_v2 import (
    ChapterRunV2Error,
    ChapterRunV2Store,
    chapter_run_v2_action,
)


def _complete(store: ChapterRunV2Store, manifest, stage: str, inputs=None):
    store.start_stage(manifest, stage, input_revisions=inputs)
    return store.complete_stage(
        manifest,
        stage,
        output={"stage": stage},
        expected_input_revisions=inputs,
    )


def test_settle_failure_resumes_without_regenerating_draft(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_001", input_revisions={"outline": "a", "facts": "1"})
    for stage in ("context", "plan", "draft", "fact_extract"):
        _complete(store, manifest, stage)
    draft_revision = manifest.stages["draft"].output_revision
    store.start_stage(manifest, "settle")
    store.fail_stage(manifest, "settle", code="SETTLE_FAILED")

    loaded = store.load(manifest.run_id)
    assert loaded is not None
    assert loaded.stages["draft"].status == "completed"
    assert loaded.stages["draft"].output_revision == draft_revision
    assert store.next_stage(loaded) == "settle"


def test_review_failure_resumes_after_committed_chapter(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_002", input_revisions={"outline": "a"})
    for stage in ("context", "plan", "draft", "fact_extract", "settle", "validate", "commit"):
        _complete(store, manifest, stage)
    assert manifest.status == "committed"
    store.start_stage(manifest, "review")
    store.fail_stage(manifest, "review", code="REVIEW_FAILED")
    assert manifest.status == "committed"
    assert manifest.stages["commit"].status == "completed"
    assert store.next_stage(manifest) == "review"


def test_stage_specific_revisions_are_merged_into_manifest(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_002", input_revisions={"outline": "a"})
    store.start_stage(
        manifest,
        "context",
        input_revisions={"review_context": "ctx-1"},
    )

    assert manifest.input_revisions == {
        "outline": "a",
        "review_context": "ctx-1",
    }
    store.complete_stage(manifest, "context", output={"ok": True})


def test_latest_reviewable_run_skips_newer_failed_run(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    reviewable = store.create("ch_002")
    for stage in (
        "context",
        "plan",
        "draft",
        "fact_extract",
        "settle",
        "validate",
        "commit",
    ):
        _complete(store, reviewable, stage)
    failed = store.create("ch_002")
    store.start_stage(failed, "context")
    store.fail_stage(failed, "context", code="CONTEXT_FAILED")

    selected = store.latest_reviewable_for_chapter("ch_002")
    assert selected is not None
    assert selected.run_id == reviewable.run_id


def test_revision_change_propagates_stale_from_plan(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_003", input_revisions={"outline": "a", "facts": "1"})
    _complete(store, manifest, "context", {"facts": "1"})
    _complete(store, manifest, "plan", {"outline": "a"})
    _complete(store, manifest, "draft", {"outline": "a", "facts": "1"})
    stale = store.mark_stale(manifest, {"outline": "b", "facts": "1"})
    assert stale == ("plan", "draft")
    assert manifest.stages["context"].status == "completed"
    assert store.next_stage(manifest) == "plan"


def test_cancel_rejects_late_model_result(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_004")
    store.request_cancel(manifest)
    with pytest.raises(ChapterRunV2Error) as error:
        store.assert_accepts_result(manifest)
    assert error.value.code == "LATE_RESULT_REJECTED"


def test_cancel_reviewed_run_is_non_mutating_terminal_diagnostic(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_004")
    for stage in (
        "context",
        "plan",
        "draft",
        "fact_extract",
        "settle",
        "validate",
        "commit",
        "review",
    ):
        _complete(store, manifest, stage)
    current = chapter_run_v2_action(tmp_path, "demo", {"action": "get", "run_id": manifest.run_id})

    result = chapter_run_v2_action(
        tmp_path,
        "demo",
        {
            "action": "cancel",
            "run_id": manifest.run_id,
            "revision": current["revision"],
            "reason": "too_late",
        },
    )

    assert result["code"] == "RUN_ALREADY_TERMINAL"
    assert result["already_terminal"] is True
    assert result["cancelled"] is False
    assert result["run"]["status"] == "reviewed"
    reloaded = store.load(manifest.run_id)
    assert reloaded is not None
    assert reloaded.status == "reviewed"
    assert reloaded.cancel_requested is False


def test_intervention_requires_confirmed_state_machine_and_stales_plan(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_005", input_revisions={"facts": "one"})
    _complete(store, manifest, "context")
    _complete(store, manifest, "plan")
    intervention = store.add_intervention(
        manifest,
        scope="chapter",
        risk="high",
        request="主角改为拒绝交易",
        affected_items=["ch_005", "outline"],
        rewrite_required=True,
    )
    intervention = store.update_intervention(
        manifest,
        intervention.intervention_id,
        state="facts_read",
        facts_revision="one",
    )
    intervention = store.update_intervention(
        manifest, intervention.intervention_id, state="classified", impact=["plan", "draft"]
    )
    intervention = store.update_intervention(
        manifest, intervention.intervention_id, state="proposed", proposal="修改章纲并重写草稿"
    )
    intervention = store.update_intervention(
        manifest, intervention.intervention_id, state="awaiting_confirmation"
    )
    with pytest.raises(ChapterRunV2Error) as error:
        store.update_intervention(manifest, intervention.intervention_id, state="confirmed")
    assert error.value.code == "CONFIRMATION_REQUIRED"
    intervention = store.update_intervention(
        manifest, intervention.intervention_id, state="confirmed", confirm=True
    )
    store.update_intervention(manifest, intervention.intervention_id, state="applied", confirm=True)
    assert manifest.stages["context"].status == "completed"
    assert manifest.stages["plan"].status == "stale"


def test_artifact_path_cannot_escape_project(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_006")
    store.start_stage(manifest, "context")
    with pytest.raises(ChapterRunV2Error) as error:
        store.complete_stage(manifest, "context", artifact="../outside.json")
    assert error.value.code == "PATH_OUT_OF_BOUNDS"


def test_shared_action_requires_current_revision_for_intervention(tmp_path: Path) -> None:
    store = ChapterRunV2Store(tmp_path, "demo")
    manifest = store.create("ch_007")
    current = chapter_run_v2_action(tmp_path, "demo", {"action": "get", "run_id": manifest.run_id})
    created = chapter_run_v2_action(
        tmp_path,
        "demo",
        {
            "action": "record_intervention",
            "run_id": manifest.run_id,
            "revision": current["revision"],
            "request": "改变本章结尾",
        },
    )
    assert created["intervention"]["state"] == "recorded"

    with pytest.raises(ChapterRunV2Error) as stale:
        chapter_run_v2_action(
            tmp_path,
            "demo",
            {
                "action": "record_intervention",
                "run_id": manifest.run_id,
                "revision": current["revision"],
                "request": "使用已经过时的 revision",
            },
        )
    assert stale.value.code == "STALE_REVISION"
