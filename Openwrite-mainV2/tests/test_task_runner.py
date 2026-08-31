from __future__ import annotations

import time
from pathlib import Path
from threading import Event

import yaml

from tools.init_project import init_project
from tools.task_runner import PersistentTaskRunner, TaskContext
from tools.task_store import TaskStore


def _wait_for(store: TaskStore, task_id: str, status: str, timeout: float = 3.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = store.load(task_id)
        if task and task.get("status") == status:
            return task
        time.sleep(0.01)
    raise AssertionError(f"task {task_id} did not reach {status}")


def test_task_store_externalizes_large_input_and_redacts_credentials(tmp_path: Path):
    init_project(tmp_path, "demo")
    store = TaskStore(tmp_path, "demo")
    content = ("长文本\r\n" * 1800) + "没有末尾换行"

    task = store.create(
        "source_extract",
        {"content": content, "api_key": "private", "nested": {"secret": "hidden"}},
    )

    assert task["input"]["api_key"] == "[redacted]"
    assert task["input"]["nested"]["secret"] == "[redacted]"
    assert task["input"]["content"]["$artifact"].startswith("inputs/")
    assert store.materialize_input(task)["content"] == content
    assert store.events(task["task_id"])[0]["event"] == "task_created"
    assert store.index_path.is_file()


def test_persistent_task_runner_records_real_phases_and_result(tmp_path: Path):
    init_project(tmp_path, "demo")

    def handler(payload: dict, context: TaskContext) -> dict:
        context.phase("preparing", "assembling packet")
        context.phase("model", "calling model")
        context.phase("validating", "checking output")
        context.checkpoint()
        context.phase("committing", "writing result")
        return {"chapter_id": payload["chapter_id"], "path": "data/result.md"}

    runner = PersistentTaskRunner(tmp_path, "demo", handlers={"chapter_write": handler})
    try:
        task = runner.submit(
            "chapter_write",
            {"chapter_id": "ch_001"},
            chapter_id="ch_001",
            input_summary="写 ch_001",
        )
        completed = _wait_for(runner.store, task["task_id"], "completed")

        assert completed["phase"] == "complete"
        assert completed["result"]["chapter_id"] == "ch_001"
        phases = [event["phase"] for event in runner.store.events(task["task_id"])]
        assert phases == [
            "queued",
            "reading",
            "preparing",
            "model",
            "validating",
            "committing",
            "complete",
        ]
    finally:
        runner.shutdown(wait=True)


def test_terminal_event_is_durable_before_completed_snapshot(tmp_path: Path, monkeypatch):
    init_project(tmp_path, "demo")
    store = TaskStore(tmp_path, "demo")
    task = store.create("chapter_review", {"chapter_id": "ch_001"})
    original_save = store._save_unlocked
    observed: dict[str, bool] = {}

    def checking_save(record: dict) -> None:
        if record.get("status") == "completed":
            events = store.events(record["task_id"])
            observed["completion_event_exists"] = bool(
                events and events[-1]["event"] == "task_completed"
            )
            observed["watermark_matches"] = bool(
                events and record.get("last_event_id") == events[-1]["event_id"]
            )
        original_save(record)

    monkeypatch.setattr(store, "_save_unlocked", checking_save)
    completed = store.transition(
        task["task_id"],
        status="completed",
        phase="complete",
        updates={"result": {"score": 90}},
        event="task_completed",
    )

    assert observed == {
        "completion_event_exists": True,
        "watermark_matches": True,
    }
    assert completed["last_event_id"] == store.events(task["task_id"])[-1]["event_id"]


def test_pending_and_running_tasks_can_be_cancelled_without_result(tmp_path: Path):
    init_project(tmp_path, "demo")
    started = Event()
    release = Event()

    def handler(payload: dict, context: TaskContext) -> dict:
        del payload
        context.phase("model", "waiting")
        started.set()
        while not release.wait(0.01):
            context.checkpoint()
        context.checkpoint()
        return {"unexpected": True}

    runner = PersistentTaskRunner(tmp_path, "demo", handlers={"revision_generate": handler})
    try:
        running = runner.submit("revision_generate", {"chapter_id": "ch_001"})
        assert started.wait(1)
        pending = runner.submit("revision_generate", {"chapter_id": "ch_002"})

        runner.cancel(pending["task_id"])
        cancelled_pending = _wait_for(
            runner.store, pending["task_id"], "cancelled"
        )
        assert cancelled_pending["result"] == {}

        runner.cancel(running["task_id"])
        cancelled_running = _wait_for(
            runner.store, running["task_id"], "cancelled"
        )
        assert cancelled_running["result"] == {}
    finally:
        release.set()
        runner.shutdown(wait=True)


def test_startup_marks_orphaned_running_tasks_interrupted_and_retryable(tmp_path: Path):
    init_project(tmp_path, "demo")
    store = TaskStore(tmp_path, "demo")
    original = store.create("chapter_review", {"chapter_id": "ch_001"})
    store.transition(
        original["task_id"],
        status="running",
        phase="model",
        event="task_started",
    )

    runner = PersistentTaskRunner(
        tmp_path,
        "demo",
        handlers={
            "chapter_review": lambda payload, context: {
                "chapter_id": payload["chapter_id"],
                "score": 90,
            }
        },
    )
    try:
        interrupted = runner.store.load(original["task_id"])
        assert interrupted is not None and interrupted["status"] == "interrupted"
        assert interrupted["error"]["code"] == "PROCESS_INTERRUPTED"

        retried = runner.retry(original["task_id"])
        completed = _wait_for(runner.store, retried["task_id"], "completed")
        assert completed["retry_of"] == original["task_id"]
        assert completed["attempt"] == 2
        assert completed["result"]["score"] == 90
    finally:
        runner.shutdown(wait=True)


def test_retry_preserves_persisted_continuous_write_progress(tmp_path: Path):
    init_project(tmp_path, "demo")
    store = TaskStore(tmp_path, "demo")
    original = store.create("continuous_write", {"max_chapters": 2})
    store.transition(
        original["task_id"],
        status="running",
        phase="committing",
        updates={
            "result": {
                "completed_chapters": [{"chapter_id": "ch_001"}],
                "usage": {"total_tokens": 120},
            }
        },
        event="task_progress_saved",
    )
    observed: dict = {}

    def handler(payload: dict, context: TaskContext) -> dict:
        del context
        observed.update(payload)
        return {"completed_chapters": payload["_already_completed"]}

    runner = PersistentTaskRunner(
        tmp_path,
        "demo",
        handlers={"continuous_write": handler},
    )
    try:
        retried = runner.retry(original["task_id"])
        completed = _wait_for(runner.store, retried["task_id"], "completed")
        assert observed["_already_completed"] == [{"chapter_id": "ch_001"}]
        assert observed["_already_used"] == {"total_tokens": 120}
        assert completed["result"]["completed_chapters"] == [
            {"chapter_id": "ch_001"}
        ]
    finally:
        runner.shutdown(wait=True)


def test_task_store_clear_failed_removes_only_failed_task_data(tmp_path: Path):
    init_project(tmp_path, "demo")
    store = TaskStore(tmp_path, "demo")

    failed = store.create(
        "source_extract",
        {"content": "input-" * 2000},
        input_summary="失败来源",
    )
    failed = store.transition(
        failed["task_id"],
        updates={"result": {"report": "result-" * 2000}},
        event="task_progress_saved",
    )
    failed = store.transition(
        failed["task_id"],
        status="failed",
        updates={
            "error": {
                "code": "TEST_FAILURE",
                "message": "用于验证清除",
                "recoverable": True,
            }
        },
        event="task_failed",
    )
    completed = store.create("chapter_review", {"chapter_id": "ch_001"})
    completed = store.transition(
        completed["task_id"],
        status="completed",
        phase="complete",
        updates={"result": {"score": 90}},
        event="task_completed",
    )

    failed_id = failed["task_id"]
    completed_id = completed["task_id"]
    failed_input_dir = store.root / "inputs" / failed_id
    failed_result_dir = store.root / "results" / failed_id
    assert failed_input_dir.is_dir()
    assert failed_result_dir.is_dir()
    assert store.events_path(failed_id).is_file()

    deleted = store.clear_failed()

    assert deleted["deleted_count"] == 1
    assert deleted["task_ids"] == [failed_id]
    assert store.load(failed_id) is None
    assert store.events(failed_id) == []
    assert not store.snapshot_path(failed_id).exists()
    assert not store.events_path(failed_id).exists()
    assert not failed_input_dir.exists()
    assert not failed_result_dir.exists()
    assert store.load(completed_id)["status"] == "completed"
    assert [item["task_id"] for item in store.list()] == [completed_id]
    index_tasks = yaml.safe_load(
        store.index_path.read_text(encoding="utf-8")
    )["tasks"]
    index_ids = {item["task_id"] for item in index_tasks}
    assert completed_id in index_ids
    assert failed_id not in index_ids
    assert store.clear_failed() == {"deleted_count": 0, "task_ids": []}
