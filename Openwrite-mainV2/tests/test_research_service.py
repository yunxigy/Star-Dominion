from __future__ import annotations

import json
from pathlib import Path
from threading import Thread
from unittest.mock import patch
from urllib.request import ProxyHandler, build_opener

import pytest

from tools.init_project import init_project
from tools.research_service import (
    DEEPRESEARCH_BUILD_ARTIFACTS,
    MAX_PROCESS_OUTPUT_BYTES,
    ResearchService,
    ResearchServiceError,
)
from tools.studio import create_server
from tools.studio_preferences import StudioResearchSettingsStore


def test_research_service_archives_and_reads_report(tmp_path: Path):
    novel_root = tmp_path / "novel"
    reports = novel_root / "data" / "research" / "reports"
    reports.mkdir(parents=True)
    (reports / "episode_1.md").write_text("# 研究结果\n\n正文", encoding="utf-8")
    (reports / "episode_1.json").write_text(
        json.dumps(
            {
                "title": "叙事视角",
                "status": "succeeded",
                "episode_id": "episode_1",
                "created_at": "2026-08-03T00:00:00Z",
                "metrics": {"sources": 3},
            }
        ),
        encoding="utf-8",
    )
    service = ResearchService(novel_root)
    assert service.list_reports()[0]["id"] == "episode_1"
    assert service.read_report("episode_1")["content"].startswith("# 研究结果")


def test_research_service_maps_openwrite_model_environment(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_MODEL", "local-model")
    monkeypatch.setenv("LLM_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    service = ResearchService(tmp_path)
    env = service._research_environment({"search": "none"})
    assert env["AGENT_PROVIDER"] == "openai"
    assert env["OPENAI_API_KEY"] == "test-key"
    assert env["AGENT_MODEL"] == "local-model"
    assert env["OPENAI_BASE_URL"] == "https://example.test/v1"


def test_research_settings_keep_search_credentials_private(tmp_path: Path):
    store = StudioResearchSettingsStore(tmp_path / "preferences")

    surface = store.save(
        {
            "search_provider": "bocha",
            "search_api_key": "private-bocha-key",
            "remember_api_key": True,
        }
    )

    bocha = next(item for item in surface["search_providers"] if item["id"] == "bocha")
    assert bocha["configured"] is True
    assert bocha["credential_configured"] is True
    assert "private-bocha-key" not in json.dumps(surface, ensure_ascii=False)
    assert store.credential("bocha") == "private-bocha-key"
    assert (store.credentials_path.stat().st_mode & 0o777) == 0o600


def test_research_environment_uses_routed_model_and_saved_search_key(tmp_path: Path):
    store = StudioResearchSettingsStore(tmp_path / "preferences")
    store.save(
        {
            "search_provider": "jina",
            "search_api_key": "jina-secret",
            "remember_api_key": False,
        }
    )
    service = ResearchService(tmp_path / "novel", settings_store=store)

    env = service._research_environment(
        {"search": "jina"},
        model_profile={
            "provider": "openai",
            "api_key": "model-secret",
            "base_url": "https://models.example/v1",
            "model": "research-model",
            "api_format": "responses",
        },
    )

    assert env["AGENT_PROVIDER"] == "openai"
    assert env["OPENAI_API_KEY"] == "model-secret"
    assert env["OPENAI_BASE_URL"] == "https://models.example/v1"
    assert env["AGENT_MODEL"] == "research-model"
    assert env["OPENAI_WIRE_API"] == "responses"
    assert env["JINA_API_KEY"] == "jina-secret"
    assert "jina-secret" not in store.credentials_path.read_text(encoding="utf-8")


def test_research_environment_uses_saved_jina_key_as_bing_fetch_fallback(tmp_path: Path):
    store = StudioResearchSettingsStore(tmp_path / "preferences")
    store.save(
        {
            "search_provider": "jina",
            "search_api_key": "jina-reader-secret",
            "remember_api_key": True,
        }
    )
    service = ResearchService(tmp_path / "novel", settings_store=store)

    env = service._research_environment({"search": "bing"})

    assert env["JINA_API_KEY"] == "jina-reader-secret"
    assert env["FETCH_MODE"] == "fallback"


def test_research_environment_reports_missing_search_key(tmp_path: Path):
    service = ResearchService(
        tmp_path / "novel",
        settings_store=StudioResearchSettingsStore(tmp_path / "preferences"),
    )

    with pytest.raises(ResearchServiceError, match="博查 API Key") as exc_info:
        service._research_environment({"search": "bocha"})

    assert exc_info.value.code == "RESEARCH_SEARCH_CREDENTIAL_MISSING"


def test_research_status_does_not_expose_machine_paths(tmp_path: Path):
    framework = tmp_path / "private-install" / "deepresearch"
    framework.mkdir(parents=True)
    (framework / "package.json").write_text("{}", encoding="utf-8")

    status = ResearchService(tmp_path / "novel", framework_root=framework).status()

    assert "framework_root" not in status
    assert "node" not in status
    assert "pnpm" not in status
    assert str(tmp_path) not in json.dumps(status, ensure_ascii=False)


def test_research_status_requires_built_runtime_packages(tmp_path: Path):
    framework = tmp_path / "private-install" / "deepresearch"
    (framework / "node_modules").mkdir(parents=True)
    (framework / "package.json").write_text("{}", encoding="utf-8")
    service = ResearchService(tmp_path / "novel", framework_root=framework)

    with patch("tools.research_service.shutil.which", side_effect=lambda name: f"/fake/{name}"):
        unbuilt = service.status()

    assert unbuilt["dependencies_ready"] is True
    assert unbuilt["build_ready"] is False
    assert unbuilt["available"] is False
    assert "pnpm build" in unbuilt["setup_hint"]

    for relative_path in DEEPRESEARCH_BUILD_ARTIFACTS:
        artifact = framework / relative_path
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text("export {};\n", encoding="utf-8")
    with patch("tools.research_service.shutil.which", side_effect=lambda name: f"/fake/{name}"):
        built = service.status()

    assert built["build_ready"] is True
    assert built["available"] is True


def test_research_service_rejects_report_outside_artifact_root(tmp_path: Path):
    service = ResearchService(tmp_path / "novel", framework_root=tmp_path / "framework")
    outside = tmp_path / "outside.md"
    outside.write_text("private", encoding="utf-8")

    with pytest.raises(ResearchServiceError, match="产物目录之外") as exc_info:
        service._validated_report_path(outside)

    assert exc_info.value.code == "INVALID_REPORT_PATH"


def test_research_process_output_is_bounded():
    output = bytearray(b"old")
    ResearchService._append_process_output(output, b"x" * (MAX_PROCESS_OUTPUT_BYTES + 20))

    assert len(output) == MAX_PROCESS_OUTPUT_BYTES
    assert output == b"x" * MAX_PROCESS_OUTPUT_BYTES


def test_research_service_parses_pretty_summary():
    summary = ResearchService._parse_summary(
        '{\n  "status": "succeeded",\n  "episodeId": "ep_1",\n  "report": "/tmp/report.md"\n}'
    )
    assert summary["episodeId"] == "ep_1"


def test_research_service_rejects_failed_internal_episode_after_archiving(
    tmp_path: Path, monkeypatch
):
    framework = tmp_path / "framework"
    (framework / "node_modules").mkdir(parents=True)
    (framework / "package.json").write_text("{}", encoding="utf-8")
    service = ResearchService(tmp_path / "novel", framework_root=framework)
    source_report = service.artifact_root / "EP_failed" / "final-report.md"
    source_report.parent.mkdir(parents=True)
    source_report.write_text("# 失败研究产物\n\n预算门未通过。", encoding="utf-8")

    class FakeContext:
        def phase(self, phase: str, note: str = "") -> None:
            del phase, note

        def checkpoint(self) -> None:
            return None

        def cancellation_requested(self) -> bool:
            return False

    monkeypatch.setattr(service, "status", lambda: {"available": True})
    monkeypatch.setattr("tools.research_service.shutil.which", lambda name: "/bin/echo")
    monkeypatch.setattr(
        service,
        "_parse_summary",
        lambda output: {
            "status": "failed",
            "episodeId": "EP_failed",
            "report": str(source_report),
            "metrics": {"publishGatePassed": False},
        },
    )

    with pytest.raises(ResearchServiceError) as exc_info:
        service.run(
            {"prompt": "研究悬疑小说剧情设计", "search": "none"},
            FakeContext(),
        )

    assert exc_info.value.code == "RESEARCH_EPISODE_FAILED"
    archived = service.report_root / "EP_failed.json"
    assert archived.is_file()
    assert json.loads(archived.read_text(encoding="utf-8"))["status"] == "failed"
    assert (service.report_root / "EP_failed.md").is_file()


def test_studio_exposes_research_status_and_report_route(tmp_path: Path):
    init_project(tmp_path, "demo")
    server = create_server(tmp_path, port=0)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        opener = build_opener(ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{server.server_port}/api/research") as response:
            payload = json.loads(response.read())
        assert payload["ok"] is True
        assert "available" in payload["data"]
        assert payload["data"]["reports"] == []
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
