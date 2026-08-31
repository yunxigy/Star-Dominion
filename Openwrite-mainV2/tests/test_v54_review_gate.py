from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml

import tools.chapter_pipeline as chapter_pipeline
from tools.agent.reviewer import ReviewerAgent
from tools.chapter_pipeline import commit_chapter_candidate
from tools.chapter_pipeline import execute_multi_agent_chapter
from tools.llm.response import ProviderResponseError
from tools.init_project import init_project
from tools.novel_service import NovelApplicationService
from tools.studio_application import StudioApplication
from tools.truth_manager import TruthFiles, TruthFilesManager


NOVEL_ID = "review_gate_novel"


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    _write(
        root / "novel_config.yaml",
        "novel_id: review_gate_novel\n"
        "style_id: review_gate_novel\n"
        "current_arc: arc_001\n"
        "current_chapter: ch_001\n",
    )
    novel_root = root / "data" / "novels" / NOVEL_ID
    _write(novel_root / "src" / "outline.md", "# outline\n")
    _write(
        novel_root / "data" / "manuscript" / "arc_001" / "ch_001.md",
        "# 第一章\n\n旧正文\n",
    )
    TruthFilesManager(root, NOVEL_ID).save_truth_files(
        TruthFiles(
            current_state="旧世界状态",
            ledger="旧账本",
            relationships="旧关系",
        )
    )
    return root


def _candidate(chapter_id: str = "ch_002") -> dict:
    return {
        "chapter_id": chapter_id,
        "title": "第二章 新的转折",
        "content": "候选正文内容。",
        "word_count": 7,
        "observations": "候选观察",
        "chapter_summary": "候选摘要",
        "truth_updates": {},
        "state_updates": {},
        "state_delta": {},
        "token_usage": {},
    }


def _review(*, passed: bool, score: float, severity: str = "warning") -> dict:
    return {
        "passed": passed,
        "score": score,
        "issue_details": (
            [
                {
                    "severity": severity,
                    "category": "连续性",
                    "description": "候选稿存在未解决问题",
                    "suggestion": "修订候选稿",
                }
            ]
            if not passed
            else []
        ),
    }


def test_failed_review_does_not_commit_manuscript_truth_or_memory(tmp_path: Path):
    root = _project(tmp_path)
    truth_path = root / "data" / "novels" / NOVEL_ID / "data" / "world" / "current_state.md"
    truth_before = truth_path.read_text(encoding="utf-8")

    result = commit_chapter_candidate(
        root,
        _candidate(),
        _review(passed=False, score=45, severity="critical"),
    )

    assert result["ok"] is False
    assert result["committed"] is False
    assert result["code"] == "REVIEW_GATE_BLOCKED"
    assert not (
        root
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "manuscript"
        / "arc_001"
        / "ch_002.md"
    ).exists()
    assert truth_path.read_text(encoding="utf-8") == truth_before
    assert not (
        root
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "memory"
        / "chapters"
        / "ch_002.yaml"
    ).exists()


def test_passing_review_commits_candidate_and_chapter_memory(tmp_path: Path):
    root = _project(tmp_path)

    result = commit_chapter_candidate(
        root,
        _candidate(),
        _review(passed=True, score=86),
    )

    chapter_path = (
        root
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "manuscript"
        / "arc_001"
        / "ch_002.md"
    )
    memory_path = (
        root
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "memory"
        / "chapters"
        / "ch_002.yaml"
    )
    assert result["ok"] is True
    assert result["committed"] is True
    assert chapter_path.read_text(encoding="utf-8") == "# 第二章 新的转折\n\n候选正文内容。"
    assert yaml.safe_load(memory_path.read_text(encoding="utf-8"))["summary"] == "候选摘要"


def test_review_pass_below_score_threshold_is_blocked(tmp_path: Path):
    root = _project(tmp_path)

    result = commit_chapter_candidate(
        root,
        _candidate(),
        _review(passed=True, score=69),
    )

    assert result["code"] == "REVIEW_GATE_BLOCKED"
    assert result["committed"] is False


def test_reviewer_maps_post_write_validator_errors_to_critical():
    reviewer = ReviewerAgent.__new__(ReviewerAgent)
    reviewer._audit_context_reports = []

    async def no_llm_audit(content, context, dimensions=None):
        return []

    reviewer._llm_audit = no_llm_audit
    result = asyncio.run(
        reviewer.review(
            "这不是普通叙述而是报告术语——",
            {},
        )
    )

    assert result.passed is False
    assert any(issue.severity == "critical" for issue in result.issues)


def test_reviewer_maps_malformed_llm_output_to_critical():
    reviewer = ReviewerAgent.__new__(ReviewerAgent)
    reviewer._audit_context_reports = []

    async def malformed_audit(content, context, dimensions=None):
        raise ProviderResponseError("MALFORMED_STRUCTURED_OUTPUT", "bad json")

    reviewer._llm_audit = malformed_audit
    result = asyncio.run(reviewer.review("正常正文", {}))

    assert result.passed is False
    assert any(
        issue.severity == "critical"
        and issue.category == "审稿结构化输出"
        for issue in result.issues
    )


def test_write_and_review_does_not_commit_a_failed_candidate(monkeypatch, tmp_path: Path):
    candidate = _candidate()
    commit_calls: list[dict] = []
    monkeypatch.setattr(
        chapter_pipeline,
        "execute_write_chapter",
        lambda project_root, args: {"ok": True, "candidate": candidate},
    )
    monkeypatch.setattr(
        chapter_pipeline,
        "execute_review_chapter",
        lambda project_root, args: {
            "ok": True,
            "passed": False,
            "score": 45,
            "issue_details": [{"severity": "critical", "description": "事实冲突"}],
        },
    )
    monkeypatch.setattr(
        chapter_pipeline,
        "commit_chapter_candidate",
        lambda project_root, candidate, review, **kwargs: commit_calls.append(review),
    )

    result = chapter_pipeline.execute_write_and_review_chapter(
        tmp_path,
        {"chapter_id": "ch_002", "max_revisions": 0},
    )

    assert result["ok"] is False
    assert result["committed"] is False
    assert result["code"] == "REVIEW_GATE_BLOCKED"
    assert commit_calls == []


def test_write_and_review_revises_then_commits_only_the_passing_candidate(
    monkeypatch,
    tmp_path: Path,
):
    candidates = [_candidate(), {**_candidate(), "content": "修订后的正文。"}]
    write_args: list[dict] = []
    reviews = iter(
        [
            {
                "ok": True,
                "passed": False,
                "score": 60,
                "issue_details": [{"severity": "warning", "description": "节奏平"}],
            },
            {"ok": True, "passed": True, "score": 88, "issue_details": []},
        ]
    )
    commit_calls: list[tuple[dict, dict]] = []

    def fake_write(project_root, args):
        write_args.append(dict(args))
        return {"ok": True, "candidate": candidates[len(write_args) - 1]}

    monkeypatch.setattr(chapter_pipeline, "execute_write_chapter", fake_write)
    monkeypatch.setattr(
        chapter_pipeline,
        "execute_review_chapter",
        lambda project_root, args: next(reviews),
    )
    monkeypatch.setattr(
        chapter_pipeline,
        "commit_chapter_candidate",
        lambda project_root, candidate, review, **kwargs: (
            commit_calls.append((candidate, review))
            or {"ok": True, "committed": True, "chapter_id": candidate["chapter_id"]}
        ),
    )

    result = chapter_pipeline.execute_write_and_review_chapter(
        tmp_path,
        {"chapter_id": "ch_002", "max_revisions": 2, "score_threshold": 70},
    )

    assert result["ok"] is True
    assert result["committed"] is True
    assert len(write_args) == 2
    assert write_args[1]["revision_draft"]["content"] == candidates[0]["content"]
    assert len(commit_calls) == 1
    assert commit_calls[0][0]["content"] == "修订后的正文。"


def test_application_service_exposes_unified_write_and_review(monkeypatch, tmp_path: Path):
    init_project(tmp_path, NOVEL_ID, "门禁测试")
    calls: list[dict] = []

    def fake_write_and_review(root, args):
        calls.append(dict(args))
        return {
            "ok": True,
            "committed": True,
            "chapter_id": args["chapter_id"],
            "title": "通过",
        }

    monkeypatch.setattr(
        chapter_pipeline,
        "execute_write_and_review_chapter",
        fake_write_and_review,
    )
    service = NovelApplicationService(tmp_path)

    result = service.write_and_review_chapter(
        {"chapter_id": "ch_001", "target_words": 800}
    )

    assert result["committed"] is True
    assert calls[0]["chapter_id"] == "ch_001"


def test_studio_default_write_uses_unified_write_and_review(monkeypatch, tmp_path: Path):
    init_project(tmp_path, NOVEL_ID, "Studio 门禁测试")
    _write(
        tmp_path / "data" / "novels" / NOVEL_ID / "src" / "outline.md",
        "# 第一卷\n\n## 第一幕\n\n### 第一节\n\n#### 第一章：开场\n开场冲突。\n",
    )
    calls: list[dict] = []

    def fake_write_and_review(self, payload):
        calls.append(dict(payload))
        return {"ok": True, "committed": True, "chapter_id": "ch_001"}

    monkeypatch.setattr(
        NovelApplicationService,
        "write_and_review_chapter",
        fake_write_and_review,
    )
    monkeypatch.setattr(
        StudioApplication,
        "_operation_profile",
        lambda self, operation, injected_executor=None: None,
    )
    app = StudioApplication(tmp_path)
    outline = app.outline_structure()
    recommendation = outline["recommendation"]

    result = app.write_next_chapter(
        {
            "chapter_id": recommendation["chapter_id"],
            "outline_revision": outline["revision"],
            "target_words": 800,
        }
    )

    assert result["result"]["committed"] is True
    assert calls[0]["chapter_id"] == "ch_001"
    assert calls[0]["chapter_id"] == "ch_001"


def test_studio_task_default_write_uses_unified_write_and_review(
    monkeypatch, tmp_path: Path
):
    init_project(tmp_path, NOVEL_ID, "Studio 任务门禁测试")
    calls: list[dict] = []

    def fake_write_and_review(self, payload):
        calls.append(dict(payload))
        return {"ok": True, "committed": True, "chapter_id": payload["chapter_id"]}

    monkeypatch.setattr(
        NovelApplicationService,
        "write_and_review_chapter",
        fake_write_and_review,
    )
    monkeypatch.setattr(
        StudioApplication,
        "_operation_profile",
        lambda self, operation, injected_executor=None: None,
    )
    app = StudioApplication(tmp_path)
    context = SimpleNamespace(
        progress_callback=lambda *args: None,
        cancellation_requested=lambda: False,
        phase=lambda *args: None,
        checkpoint=lambda: None,
    )

    result = app._task_write_chapter(
        {"chapter_id": "ch_001", "target_words": 800},
        context,
    )

    assert result["committed"] is True
    assert calls[0]["chapter_id"] == "ch_001"


def test_continuous_write_does_not_review_again_after_unified_write(
    monkeypatch, tmp_path: Path
):
    init_project(tmp_path, NOVEL_ID, "连续写作门禁测试")
    app = StudioApplication(tmp_path)
    context = SimpleNamespace(
        phase=lambda *args: None,
        checkpoint=lambda: None,
        persist_progress=lambda *args: None,
        await_confirmation=lambda *args: None,
    )
    monkeypatch.setattr(
        app,
        "outline_structure",
        lambda chapter_id="": {
            "recommendation": {
                "status": "ready",
                "chapter_id": "ch_001",
                "guidance": "开场",
                "target_words": 800,
            }
        },
    )
    monkeypatch.setattr(
        app,
        "_task_write_chapter",
        lambda payload, task_context: {
            "ok": True,
            "committed": True,
            "chapter_id": payload["chapter_id"],
            "review": {"passed": True, "score": 90, "issue_details": []},
            "usage": {},
        },
    )
    monkeypatch.setattr(
        app,
        "_task_review_chapter",
        lambda payload, task_context: pytest.fail("统一写作结果不应再次审稿"),
    )

    result = app._task_continuous_write(
        {"max_chapters": 1, "minimum_review_score": 82},
        context,
    )

    assert result["completed_chapters"][0]["review"]["score"] == 90
    if app._task_runner is not None:
        app._task_runner.shutdown(wait=True)


def test_multi_agent_failed_review_never_writes_formal_chapter(
    monkeypatch, tmp_path: Path
):
    root = _project(tmp_path)
    truth_path = (
        root
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "world"
        / "current_state.md"
    )
    truth_before = truth_path.read_text(encoding="utf-8")

    class FakeDirector:
        def __init__(self, *args, **kwargs):
            self.persist_state = True

        def assemble_packet(self, chapter_id):
            return SimpleNamespace(to_markdown=lambda: "", chapter_id=chapter_id)

        async def run(self, **kwargs):
            return SimpleNamespace(
                draft=SimpleNamespace(
                    title="第二章",
                    content="多 Agent 候选正文",
                    word_count=9,
                    observations="观察",
                    chapter_summary="摘要",
                    state_updates={"current_state": "未来状态"},
                    state_delta={},
                    token_usage={},
                ),
                review=SimpleNamespace(
                    passed=False,
                    score=42,
                    summary="存在事实冲突",
                    issues=[
                        SimpleNamespace(
                            severity="critical",
                            category="连续性",
                            description="事实冲突",
                            suggestion="修订",
                            dimension=2,
                            evidence="证据",
                        )
                    ],
                ),
                applied_state_updates={},
                new_concepts=[],
            )

    monkeypatch.setattr("tools.agent.MultiAgentDirector", FakeDirector)

    result = execute_multi_agent_chapter(
        root,
        {"chapter_id": "ch_002"},
    )

    assert result["ok"] is False
    assert result["committed"] is False
    assert result["code"] == "REVIEW_GATE_BLOCKED"
    assert not (
        root
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "manuscript"
        / "arc_001"
        / "ch_002.md"
    ).exists()
    assert truth_path.read_text(encoding="utf-8") == truth_before
