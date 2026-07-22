import json
from pathlib import Path
import subprocess

import pytest

from app.config import Settings
from app.integrations.candidate_workers import SubprocessCandidateWorker, WorkerCommand


def test_settings_parse_worker_commands_as_argument_arrays(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(
        "CATALYST_WORKER_COMMAND_JSON",
        json.dumps({"args": ["python", "-m", "worker"], "cwd": str(tmp_path), "timeout_seconds": 60}),
    )

    settings = Settings.from_env()

    catalyst = next(command for command in settings.worker_commands if command.source_id == "catalyst")
    assert catalyst.args == ["python", "-m", "worker"]
    assert catalyst.cwd == tmp_path


def test_development_registers_bundled_candidate_workers(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("STOCK_ENV", "development")
    monkeypatch.setenv("STOCK_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("CATALYST_WORKER_COMMAND_JSON", raising=False)
    monkeypatch.delenv("USER_STRATEGY_WORKER_COMMAND_JSON", raising=False)
    monkeypatch.delenv("CATALYST_REPORT_PATH", raising=False)
    monkeypatch.delenv("USER_STRATEGY_SNAPSHOT_PATH", raising=False)

    settings = Settings.from_env()
    commands = {command.source_id: command for command in settings.worker_commands}

    assert set(commands) == {"catalyst", "user_strategy"}
    assert commands["catalyst"].args[1:3] == ["-m", "ashare_us_catalyst.cli"]
    assert commands["catalyst"].env["PYTHONPATH"] == "src"
    assert commands["catalyst"].args[-2:] == ["--top", "5"]
    assert settings.catalyst_report_path.name == "data"
    assert commands["user_strategy"].args[1:3] == ["-m", "workers.user_strategy_snapshot"]
    assert commands["user_strategy"].args[-1] == str(settings.user_strategy_snapshot_path.resolve())


def test_production_registers_bundled_workers_without_extra_command_configuration(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("STOCK_ENV", "production")
    monkeypatch.setenv("STOCK_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STOCK_MODEL_MASTER_KEY", "model-key")
    monkeypatch.setenv("STOCK_GATEWAY_SERVICE_TOKEN", "gateway-token")
    monkeypatch.setenv("STOCK_ROUTE_SIGNING_KEY", "route-key")
    monkeypatch.setenv("SITE_AUTH_INTERNAL_KEY", "site-auth-key")
    monkeypatch.delenv("CATALYST_WORKER_COMMAND_JSON", raising=False)
    monkeypatch.delenv("USER_STRATEGY_WORKER_COMMAND_JSON", raising=False)

    settings = Settings.from_env()

    assert {command.source_id for command in settings.worker_commands} == {"catalyst", "user_strategy"}


def test_settings_reject_string_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CATALYST_WORKER_COMMAND_JSON", json.dumps({"args": "python -m worker"}))

    with pytest.raises(ValueError, match="参数数组"):
        Settings.from_env()


def test_worker_executes_without_shell_and_redacts_sensitive_output(tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def runner(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        captured["args"] = args
        captured.update(kwargs)
        return subprocess.CompletedProcess(args, 0, stdout="generated\napi key sk-secretvalue", stderr="")

    worker = SubprocessCandidateWorker(
        WorkerCommand(
            source_id="catalyst",
            source_name="九点猫研",
            args=["python", "worker.py"],
            cwd=tmp_path,
            env={"PYTHONPATH": "src"},
        ),
        runner=runner,
    )
    result = worker.run()

    assert captured["args"] == ["python", "worker.py"]
    assert captured["shell"] is False
    assert captured["cwd"] == tmp_path
    assert captured["env"]["PYTHONPATH"] == "src"  # type: ignore[index]
    assert result.status == "succeeded"
    assert "secretvalue" not in result.summary
    assert "[REDACTED]" in result.summary


def test_worker_returns_timeout_without_raising(tmp_path: Path) -> None:
    def runner(args: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        raise subprocess.TimeoutExpired(args, 3)

    worker = SubprocessCandidateWorker(
        WorkerCommand(
            source_id="user_strategy",
            source_name="用户策略",
            args=["python", "worker.py"],
            cwd=tmp_path,
            timeout_seconds=3,
        ),
        runner=runner,
    )

    result = worker.run()

    assert result.status == "timeout"
    assert result.exit_code is None
    assert result.summary == "Worker 超时（3 秒）"
