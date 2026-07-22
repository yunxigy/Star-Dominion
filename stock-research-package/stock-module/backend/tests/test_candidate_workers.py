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

    assert len(settings.worker_commands) == 1
    assert settings.worker_commands[0].source_id == "catalyst"
    assert settings.worker_commands[0].args == ["python", "-m", "worker"]
    assert settings.worker_commands[0].cwd == tmp_path


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
