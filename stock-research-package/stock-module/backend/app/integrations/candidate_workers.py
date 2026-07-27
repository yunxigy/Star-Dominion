"""Safe process boundary for preconfigured candidate snapshot workers."""

from collections.abc import Callable
import os
from pathlib import Path
import re
import subprocess
from time import monotonic
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class WorkerCommand(BaseModel):
    source_id: str
    source_name: str
    args: list[str] = Field(min_length=1)
    cwd: Path
    timeout_seconds: int = Field(default=900, ge=1, le=3600)
    env: dict[str, str] = Field(default_factory=dict)

    @field_validator("args")
    @classmethod
    def validate_args(cls, value: list[str]) -> list[str]:
        if any(not isinstance(item, str) or not item.strip() for item in value):
            raise ValueError("Worker args 必须是非空字符串参数数组")
        return value


class WorkerResult(BaseModel):
    source_id: str
    source_name: str
    status: Literal["succeeded", "failed", "timeout"]
    exit_code: int | None
    duration_ms: int
    summary: str


Runner = Callable[..., subprocess.CompletedProcess[str]]


class SubprocessCandidateWorker:
    def __init__(self, command: WorkerCommand, runner: Runner = subprocess.run) -> None:
        self.command = command
        self._runner = runner

    @property
    def source_id(self) -> str:
        return self.command.source_id

    @property
    def source_name(self) -> str:
        return self.command.source_name

    def run(self) -> WorkerResult:
        started = monotonic()
        try:
            completed = self._runner(
                self.command.args,
                shell=False,
                cwd=self.command.cwd,
                timeout=self.command.timeout_seconds,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
                env={**os.environ, **self.command.env},
            )
        except subprocess.TimeoutExpired:
            return WorkerResult(
                source_id=self.command.source_id,
                source_name=self.command.source_name,
                status="timeout",
                exit_code=None,
                duration_ms=round((monotonic() - started) * 1000),
                summary=f"Worker 超时（{self.command.timeout_seconds} 秒）",
            )
        except OSError as exc:
            return WorkerResult(
                source_id=self.command.source_id,
                source_name=self.command.source_name,
                status="failed",
                exit_code=None,
                duration_ms=round((monotonic() - started) * 1000),
                summary=_safe_summary(str(exc)),
            )

        output = completed.stdout if completed.returncode == 0 else completed.stderr or completed.stdout
        return WorkerResult(
            source_id=self.command.source_id,
            source_name=self.command.source_name,
            status="succeeded" if completed.returncode == 0 else "failed",
            exit_code=completed.returncode,
            duration_ms=round((monotonic() - started) * 1000),
            summary=_safe_summary(output) or ("Worker 完成" if completed.returncode == 0 else "Worker 执行失败"),
        )


def _safe_summary(value: str, limit: int = 300) -> str:
    text = " ".join(str(value).split())
    text = re.sub(r"\bsk-[A-Za-z0-9_-]+", "[REDACTED]", text, flags=re.IGNORECASE)
    text = re.sub(r"\bBearer\s+[A-Za-z0-9._-]+", "Bearer [REDACTED]", text, flags=re.IGNORECASE)
    return text[:limit]
