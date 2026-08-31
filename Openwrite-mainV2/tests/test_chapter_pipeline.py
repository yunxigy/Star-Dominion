from pathlib import Path
from types import SimpleNamespace

import pytest

import tools.agent as agent_module
import tools.chapter_pipeline as chapter_pipeline_module
import tools.llm as llm_module
from tools.agent.book_state import BookStage, BookStateStore
from tools.chapter_memory import ChapterMemoryStore
from tools.chapter_pipeline import (
    apply_runtime_delta_with_fallback,
    configure_writer_llm,
)
from tools.chapter_run_store import ChapterRunStore
from tools.chapter_run_v2 import ChapterRunV2Store
from tools.init_project import init_project
from tools.novel_service import NovelApplicationService, NovelServiceError
from tools.review_store import ReviewStore
from tools.truth_manager import TruthFiles, TruthFilesManager
from tools.workflow_scheduler import WorkflowScheduler


def _fake_llm(monkeypatch) -> None:
    monkeypatch.setattr(
        llm_module.LLMConfig,
        "from_env",
        classmethod(lambda cls: SimpleNamespace(model="fake-model")),
    )
    monkeypatch.setattr(llm_module, "LLMClient", lambda config: object())
    monkeypatch.setattr(
        agent_module,
        "AgentContext",
        lambda client, model, project_root: SimpleNamespace(
            client=client,
            model=model,
            project_root=project_root,
        ),
    )


def test_deepseek_flash_writer_disables_thinking_by_default(monkeypatch):
    monkeypatch.delenv("OPENWRITE_WRITER_THINKING", raising=False)
    config = SimpleNamespace(
        provider="openai",
        base_url="https://api.deepseek.com",
        model="deepseek-v4-flash",
        max_tokens=24000,
        extra={},
    )

    summary = configure_writer_llm(config)

    assert summary["thinking"] == "disabled"
    assert config.extra["extra_body"]["thinking"] == {"type": "disabled"}


def test_writer_thinking_auto_preserves_explicit_provider_option(monkeypatch):
    monkeypatch.delenv("OPENWRITE_WRITER_THINKING", raising=False)
    config = SimpleNamespace(
        provider="openai",
        base_url="https://api.deepseek.com",
        model="deepseek-v4-flash",
        max_tokens=24000,
        extra={"extra_body": {"thinking": {"type": "enabled"}}},
    )

    summary = configure_writer_llm(config)

    assert summary["thinking"] == "enabled"
    assert config.extra["extra_body"]["thinking"] == {"type": "enabled"}


def test_runtime_delta_apply_falls_back_to_additive_legacy_updates(tmp_path: Path):
    manager = TruthFilesManager(tmp_path, "demo")
    manager.save_truth_files(TruthFiles(current_state="原有事实"))

    effective, reason = apply_runtime_delta_with_fallback(
        manager,
        {
            "chapter_id": "ch_007",
            "operations": [
                {
                    "op": "append",
                    "collection": "timeline",
                    "value": {
                        "chapter": "ch_007",
                        "detail": "字段名不符合 schema",
                    },
                }
            ],
        },
        {"current_state": "本章新增事实"},
        chapter_id="ch_007",
        known_entities=[],
    )

    assert reason
    assert effective["operations"][0]["collection"] == "current_state"
    projection = manager.load_truth_files().current_state
    assert "原有事实" in projection
    assert "本章新增事实" in projection


def test_default_pipeline_commits_write_and_review_lifecycle(
    tmp_path: Path, monkeypatch
):
    init_project(tmp_path, "demo", "统一管线")
    _fake_llm(monkeypatch)
    writer_calls: list[dict] = []
    reviewer_calls: list[dict] = []

    class FakeWriter:
        def __init__(self, agent_ctx):
            self.agent_ctx = agent_ctx

        async def write_chapter(self, **kwargs):
            writer_calls.append(kwargs)
            return SimpleNamespace(
                title="第一章 钟差",
                content="雨落在钟楼上。",
                word_count=8,
                state_updates={
                    "current_state": "林岑已经进入钟楼。",
                    "particle_ledger": "旧信：仍未拆封。",
                    "character_matrix": "林岑 -> 守钟人：怀疑。",
                },
                chapter_summary="林岑在雨夜进入钟楼。",
                observations="钟楼每天慢十三秒。",
                token_usage={"total_tokens": 120},
            )

    class FakeReviewer:
        def __init__(self, agent_ctx):
            self.agent_ctx = agent_ctx

        async def review(self, **kwargs):
            reviewer_calls.append(kwargs)
            return SimpleNamespace(
                passed=True,
                score=96,
                summary="连续性与风格检查通过。",
                issues=[],
            )

    monkeypatch.setattr(agent_module, "WriterAgent", FakeWriter)
    monkeypatch.setattr(agent_module, "ReviewerAgent", FakeReviewer)

    service = NovelApplicationService(tmp_path)
    written = service.write_chapter(
        {
            "chapter_id": "ch_001",
            "target_words": 800,
            "guidance": "以钟声结束",
        }
    )
    reviewed = service.review_chapter("ch_001")

    assert written["ok"] is True
    assert reviewed["passed"] is True
    assert writer_calls[0]["context"]["target_words"] == 800
    assert "以钟声结束" in writer_calls[0]["context"]["external_context"]
    assert "雨落在钟楼上" in reviewer_calls[0]["content"]
    assert reviewer_calls[0]["context"]["target_words"] == 800
    novel_root = tmp_path / "data" / "novels" / "demo"
    assert (novel_root / "data" / "manuscript" / "arc_001" / "ch_001.md").exists()
    memory = ChapterMemoryStore(tmp_path, "demo").load("ch_001")
    assert memory is not None and memory["summary"] == "林岑在雨夜进入钟楼。"
    truth = TruthFilesManager(tmp_path, "demo").load_truth_files()
    assert "林岑已经进入钟楼" in truth.current_state
    assert ReviewStore(tmp_path, "demo").load("ch_001")["score"] == 96
    run = ChapterRunStore(tmp_path, "demo").latest_for_chapter("ch_001")
    assert run is not None and run.status == "reviewed"
    assert run.effective_target_words == 800
    workflow = WorkflowScheduler(tmp_path, "demo").load_workflow("ch_001")
    assert workflow is not None and workflow.current_stage == "user_confirm"
    state = BookStateStore(tmp_path, "demo").load_or_create()
    assert state.stage == BookStage.CHAPTER_PREFLIGHT


def test_default_write_pipeline_discards_model_result_when_task_is_cancelled(
    tmp_path: Path, monkeypatch
):
    init_project(tmp_path, "demo", "取消写作")
    _fake_llm(monkeypatch)
    cancellation = {"requested": False}
    phases: list[str] = []

    class FakeWriter:
        def __init__(self, agent_ctx):
            self.agent_ctx = agent_ctx

        async def write_chapter(self, **kwargs):
            del kwargs
            cancellation["requested"] = True
            return SimpleNamespace(
                title="不应落盘",
                content="这段模型结果必须被丢弃。",
                word_count=12,
                state_updates={},
                chapter_summary="",
                observations="",
                token_usage={},
            )

    monkeypatch.setattr(agent_module, "WriterAgent", FakeWriter)
    service = NovelApplicationService(tmp_path)

    with pytest.raises(NovelServiceError) as cancelled:
        service.write_chapter(
            {
                "chapter_id": "ch_001",
                "target_words": 800,
                "_task_phase": lambda phase, note: phases.append(phase),
                "_cancel_requested": lambda: cancellation["requested"],
            }
        )

    assert cancelled.value.code == "TASK_CANCELLED"
    assert "model" in phases and "validating" in phases
    chapter = (
        tmp_path
        / "data"
        / "novels"
        / "demo"
        / "data"
        / "manuscript"
        / "arc_001"
        / "ch_001.md"
    )
    assert not chapter.exists()
    run_v2 = ChapterRunV2Store(tmp_path, "demo").latest_for_chapter("ch_001")
    assert run_v2 is not None
    assert run_v2.status == "cancelled"
    assert run_v2.stages["draft"].status == "failed"


def test_write_pipeline_resumes_settle_without_calling_writer_again(
    tmp_path: Path, monkeypatch
):
    init_project(tmp_path, "demo", "恢复写作")
    _fake_llm(monkeypatch)
    writer_calls = 0

    class FakeWriter:
        def __init__(self, agent_ctx):
            self.agent_ctx = agent_ctx

        async def write_chapter(self, **kwargs):
            nonlocal writer_calls
            del kwargs
            writer_calls += 1
            return SimpleNamespace(
                title="第一章 恢复点",
                content="草稿只应生成一次。",
                word_count=9,
                state_updates={"current_state": "恢复测试事实。"},
                state_delta={},
                chapter_summary="一次草稿，两次提交尝试。",
                observations="",
                token_usage={"total_tokens": 42},
            )

    monkeypatch.setattr(agent_module, "WriterAgent", FakeWriter)
    real_apply = chapter_pipeline_module.apply_runtime_delta_with_fallback
    failures = 1

    def fail_settle_once(*args, **kwargs):
        nonlocal failures
        if failures:
            failures -= 1
            raise RuntimeError("injected settle failure")
        return real_apply(*args, **kwargs)

    monkeypatch.setattr(
        chapter_pipeline_module,
        "apply_runtime_delta_with_fallback",
        fail_settle_once,
    )
    service = NovelApplicationService(tmp_path)
    with pytest.raises(NovelServiceError):
        service.write_chapter({"chapter_id": "ch_001", "target_words": 800})

    store = ChapterRunV2Store(tmp_path, "demo")
    failed = store.latest_for_chapter("ch_001")
    assert failed is not None
    assert failed.status == "drafted"
    assert failed.stages["draft"].status == "completed"
    assert failed.stages["settle"].status == "failed"

    resumed = service.write_chapter(
        {
            "chapter_id": "ch_001",
            "target_words": 800,
            "run_id_v2": failed.run_id,
        }
    )
    assert resumed["ok"] is True
    assert resumed["run_id_v2"] == failed.run_id
    assert writer_calls == 1
    completed = store.load(failed.run_id)
    assert completed is not None and completed.status == "committed"


def test_review_pipeline_recovers_only_review_on_committed_run(
    tmp_path: Path, monkeypatch
):
    init_project(tmp_path, "demo", "恢复审稿")
    _fake_llm(monkeypatch)

    class FakeWriter:
        def __init__(self, agent_ctx):
            self.agent_ctx = agent_ctx

        async def write_chapter(self, **kwargs):
            del kwargs
            return SimpleNamespace(
                title="第一章 已提交",
                content="正文已经提交。",
                word_count=7,
                state_updates={},
                state_delta={},
                chapter_summary="",
                observations="",
                token_usage={},
            )

    review_calls = 0

    class FlakyReviewer:
        def __init__(self, agent_ctx):
            self.agent_ctx = agent_ctx

        async def review(self, **kwargs):
            nonlocal review_calls
            del kwargs
            review_calls += 1
            if review_calls == 1:
                raise RuntimeError("injected review failure")
            return SimpleNamespace(
                passed=True,
                score=90,
                summary="恢复后通过。",
                issues=[],
            )

    monkeypatch.setattr(agent_module, "WriterAgent", FakeWriter)
    monkeypatch.setattr(agent_module, "ReviewerAgent", FlakyReviewer)
    service = NovelApplicationService(tmp_path)
    written = service.write_chapter({"chapter_id": "ch_001", "target_words": 800})
    with pytest.raises(NovelServiceError):
        service.review_chapter("ch_001")

    store = ChapterRunV2Store(tmp_path, "demo")
    committed = store.load(written["run_id_v2"])
    assert committed is not None and committed.status == "committed"
    assert committed.stages["review"].status == "failed"

    reviewed = service.review_chapter("ch_001")
    assert reviewed["run_id_v2"] == written["run_id_v2"]
    assert review_calls == 2
    final = store.load(written["run_id_v2"])
    assert final is not None and final.status == "reviewed"
