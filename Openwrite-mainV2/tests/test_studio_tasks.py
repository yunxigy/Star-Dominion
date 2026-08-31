from __future__ import annotations

import json
import time
from pathlib import Path
from threading import Thread
from urllib.request import ProxyHandler, Request, build_opener

from tools.cli import _save_chapter
from tools.init_project import init_project
from tools.model_profiles import ModelProfileStore, active_model_profile
from tools.studio import StudioApplication, create_server
from tools.task_store import TaskStore


def _wait(app: StudioApplication, task_id: str, statuses: set[str], timeout: float = 3) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = app.get_task(task_id)["task"]
        if task["status"] in statuses:
            return task
        time.sleep(0.01)
    raise AssertionError(f"task {task_id} did not reach {statuses}")


def test_studio_runs_write_and_review_through_persistent_tasks(tmp_path: Path):
    init_project(tmp_path, "demo")

    def writer(root: Path, args: dict) -> dict:
        path = _save_chapter(root, "demo", args["chapter_id"], "第一章", "门外有人。")
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "title": "第一章",
            "word_count": 5,
            "draft_path": str(path),
        }

    def reviewer(root: Path, args: dict) -> dict:
        del root
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "passed": True,
            "score": 92,
            "issues": 0,
            "issue_details": [],
        }

    app = StudioApplication(tmp_path, writer_executor=writer, review_executor=reviewer)
    try:
        write_task = app.create_task(
            {
                "type": "chapter_write",
                "input": {"chapter_id": "ch_001", "target_words": 800},
            }
        )
        written = _wait(app, write_task["task_id"], {"completed"})
        assert written["result"]["chapter_id"] == "ch_001"

        review_task = app.create_task(
            {
                "type": "chapter_review",
                "input": {"path": "data/manuscript/arc_001/ch_001.md"},
            }
        )
        reviewed = _wait(app, review_task["task_id"], {"completed"})
        assert reviewed["result"]["score"] == 92
        surface = app.task_surface()
        assert surface["counts"]["completed"] == 2
        assert app.get_task(review_task["task_id"])["events"][-1]["event"] == "task_completed"
    finally:
        if app._task_runner is not None:
            app._task_runner.shutdown(wait=True)


def test_studio_routes_write_and_review_tasks_to_different_profiles(tmp_path: Path):
    init_project(tmp_path, "demo")
    profiles = ModelProfileStore(tmp_path / "model-settings")
    for profile_id, model in (("prose", "writer-model"), ("critic", "review-model")):
        profiles.save_profile(
            {
                "id": profile_id,
                "label": profile_id,
                "provider": "openai",
                "base_url": "https://models.example/v1",
                "model": model,
                "api_format": "chat",
                "context_tokens": 64000,
                "max_output_tokens": 4096,
            },
            api_key=f"{profile_id}-secret",
        )
    profiles.save_routes({"chapter_write": "prose", "review": "critic"})
    observed: list[tuple[str, str]] = []

    def writer(root: Path, args: dict) -> dict:
        active = active_model_profile() or {}
        observed.append(("write", str(active.get("model"))))
        path = _save_chapter(root, "demo", args["chapter_id"], "第一章", "门外有人。")
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "title": "第一章",
            "word_count": 5,
            "draft_path": str(path),
        }

    def reviewer(root: Path, args: dict) -> dict:
        del root
        active = active_model_profile() or {}
        observed.append(("review", str(active.get("model"))))
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "passed": True,
            "score": 92,
            "issues": 0,
            "issue_details": [],
        }

    app = StudioApplication(
        tmp_path,
        writer_executor=writer,
        review_executor=reviewer,
        model_profile_store=profiles,
    )
    try:
        write_task = app.create_task(
            {
                "type": "chapter_write",
                "input": {"chapter_id": "ch_001", "target_words": 800},
            }
        )
        _wait(app, write_task["task_id"], {"completed"})
        review_task = app.create_task(
            {
                "type": "chapter_review",
                "input": {"path": "data/manuscript/arc_001/ch_001.md"},
            }
        )
        _wait(app, review_task["task_id"], {"completed"})
        assert observed == [("write", "writer-model"), ("review", "review-model")]

        app.save_model_routes(
            {"routes": {"chapter_write": "critic", "review": "prose"}}
        )
        assert profiles.resolve("chapter_write")["model"] == "review-model"
        assert profiles.resolve("review")["model"] == "writer-model"
    finally:
        if app._task_runner is not None:
            app._task_runner.shutdown(wait=True)


def test_controlled_continuous_write_waits_for_confirmation_and_resumes(tmp_path: Path):
    init_project(tmp_path, "demo")

    def writer(root: Path, args: dict) -> dict:
        number = int(args["chapter_id"].split("_")[1])
        path = _save_chapter(
            root,
            "demo",
            args["chapter_id"],
            f"第{number}章",
            f"第{number}章正文。",
        )
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "title": f"第{number}章",
            "word_count": 6,
            "draft_path": str(path),
        }

    def reviewer(root: Path, args: dict) -> dict:
        del root
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "passed": True,
            "score": 90,
            "issues": 0,
            "issue_details": [],
        }

    app = StudioApplication(tmp_path, writer_executor=writer, review_executor=reviewer)
    outline = app.read_document("src/outline.md")
    app.write_document(
        outline["path"],
        """# 第一卷

## 第一幕

### 第一节

#### 第一章

开场。

#### 第二章

推进。
""",
        outline["version"],
    )
    try:
        task = app.create_task(
            {
                "type": "continuous_write",
                "input": {
                    "max_chapters": 2,
                    "minimum_review_score": 82,
                    "require_confirmation_after_each_chapter": True,
                },
            }
        )
        waiting = _wait(app, task["task_id"], {"awaiting_confirmation"})
        assert [item["chapter_id"] for item in waiting["result"]["completed_chapters"]] == [
            "ch_001"
        ]

        resumed = app.confirm_task(task["task_id"], {})
        completed = _wait(app, resumed["task_id"], {"completed"})
        assert [item["chapter_id"] for item in completed["result"]["completed_chapters"]] == [
            "ch_001",
            "ch_002",
        ]
        assert completed["result"]["stop_reason"] == "max_chapters_reached"
    finally:
        if app._task_runner is not None:
            app._task_runner.shutdown(wait=True)


def test_studio_task_http_api_persists_across_refresh(tmp_path: Path):
    init_project(tmp_path, "demo")

    def writer(root: Path, args: dict) -> dict:
        path = _save_chapter(root, "demo", args["chapter_id"], "第一章", "正文。")
        return {
            "ok": True,
            "chapter_id": args["chapter_id"],
            "title": "第一章",
            "word_count": 3,
            "draft_path": str(path),
        }

    server = create_server(tmp_path, port=0, writer_executor=writer)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    opener = build_opener(ProxyHandler({}))
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        request = Request(
            f"{base}/api/tasks",
            method="POST",
            data=json.dumps(
                {
                    "type": "chapter_write",
                    "input": {"chapter_id": "ch_001", "target_words": 800},
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-OpenWrite-Studio": "1"},
        )
        with opener.open(request) as response:
            created = json.loads(response.read())
        task_id = created["data"]["task_id"]
        _wait(server.app, task_id, {"completed"})

        with opener.open(f"{base}/api/tasks") as response:
            refreshed = json.loads(response.read())
        assert refreshed["ok"] is True
        assert refreshed["data"]["tasks"][0]["task_id"] == task_id
        with opener.open(f"{base}/api/tasks/{task_id}") as response:
            detail = json.loads(response.read())
        assert detail["data"]["events"][-1]["event"] == "task_completed"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        if server.app._task_runner is not None:
            server.app._task_runner.shutdown(wait=True)


def test_studio_task_http_api_clears_failed_tasks_and_is_idempotent(tmp_path: Path):
    init_project(tmp_path, "demo")
    store = TaskStore(tmp_path, "demo")
    failed = store.create("chapter_review", {"chapter_id": "ch_001"})
    store.transition(
        failed["task_id"],
        status="failed",
        updates={"error": {"code": "TEST_FAILURE", "message": "失败"}},
        event="task_failed",
    )
    completed = store.create("chapter_review", {"chapter_id": "ch_002"})
    store.transition(
        completed["task_id"],
        status="completed",
        phase="complete",
        event="task_completed",
    )

    server = create_server(tmp_path, port=0)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    opener = build_opener(ProxyHandler({}))
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        request = Request(
            f"{base}/api/tasks/clear-failed",
            method="POST",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "X-OpenWrite-Studio": "1",
            },
        )
        with opener.open(request) as response:
            cleared = json.loads(response.read())
        assert cleared["ok"] is True
        assert cleared["data"]["deleted_count"] == 1
        assert cleared["data"]["task_ids"] == [failed["task_id"]]

        with opener.open(f"{base}/api/tasks") as response:
            refreshed = json.loads(response.read())
        assert refreshed["data"]["counts"]["failed"] == 0
        assert [
            item["task_id"] for item in refreshed["data"]["tasks"]
        ] == [completed["task_id"]]

        request = Request(
            f"{base}/api/tasks/clear-failed",
            method="POST",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "X-OpenWrite-Studio": "1",
            },
        )
        with opener.open(request) as response:
            second = json.loads(response.read())
        assert second["data"] == {"deleted_count": 0, "task_ids": []}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        if server.app._task_runner is not None:
            server.app._task_runner.shutdown(wait=True)
