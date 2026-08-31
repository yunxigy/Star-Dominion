from pathlib import Path

from tools.chapter_run_store import ChapterRunStore


def test_chapter_run_manifest_persists_effective_target_and_revisions(tmp_path: Path):
    store = ChapterRunStore(tmp_path, "demo")
    manifest = store.create(
        "ch_007",
        requested_target_words=1200,
        outline_target_words=3200,
        effective_target_words=1200,
        provider="custom",
        model="flash",
        context_payload={"outline": "进入回响"},
        baseline_state_revision=6,
    )
    store.complete_write(manifest, draft_content="章节正文", usage={"total_tokens": 100})

    loaded = store.latest_for_chapter("ch_007")
    assert loaded is not None
    assert loaded.effective_target_words == 1200
    assert loaded.outline_target_words == 3200
    assert loaded.baseline_state_revision == 6
    assert loaded.draft_revision.startswith("sha256:")
    assert loaded.stages["write"].usage["total_tokens"] == 100


def test_latest_written_run_ignores_failed_retry(tmp_path: Path):
    store = ChapterRunStore(tmp_path, "demo")
    written = store.create(
        "ch_001",
        requested_target_words=800,
        outline_target_words=1200,
        effective_target_words=800,
        provider="custom",
        model="model-a",
        context_payload={},
        baseline_state_revision=0,
    )
    store.complete_write(written, draft_content="正文", usage={})
    failed = store.create(
        "ch_001",
        requested_target_words=2000,
        outline_target_words=1200,
        effective_target_words=2000,
        provider="custom",
        model="model-a",
        context_payload={},
        baseline_state_revision=1,
    )
    store.fail(failed, stage="write")

    latest = store.latest_for_chapter("ch_001", statuses={"written", "reviewed"})
    assert latest is not None and latest.run_id == written.run_id
