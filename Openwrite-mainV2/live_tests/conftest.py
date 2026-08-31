from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE_ROOT = Path.home() / "my_novel"
TIER_RANK = {"smoke": 1, "agent": 2, "full": 3}


def _live_tier() -> str:
    value = os.getenv("OPENWRITE_LIVE_TIER", "smoke").strip().lower()
    return value if value in TIER_RANK else "smoke"


def require_live_tier(required: str) -> None:
    if os.getenv("OPENWRITE_RUN_LIVE", "").strip() != "1":
        pytest.skip("set OPENWRITE_RUN_LIVE=1 to enable real-model diagnostics")
    if TIER_RANK[_live_tier()] < TIER_RANK[required]:
        pytest.skip(f"requires OPENWRITE_LIVE_TIER={required} or higher")
    if not os.getenv("LLM_API_KEY", "").strip():
        pytest.skip("LLM_API_KEY is required for real-model diagnostics")


def redact(value: Any) -> Any:
    secret = os.getenv("LLM_API_KEY", "")
    if isinstance(value, dict):
        return {str(key): redact(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    text = str(value) if not isinstance(value, (str, int, float, bool, type(None))) else value
    if isinstance(text, str) and secret:
        return text.replace(secret, "<redacted-api-key>")
    return text


@pytest.fixture(scope="session")
def fixture_root() -> Path:
    root = Path(os.getenv("OPENWRITE_LIVE_FIXTURE", DEFAULT_FIXTURE_ROOT)).expanduser().resolve()
    if not (root / "novel_config.yaml").is_file():
        pytest.fail(f"realistic fixture not found: {root}")
    return root


@pytest.fixture()
def live_project(tmp_path: Path, fixture_root: Path) -> Path:
    target = tmp_path / "my_novel"
    target.mkdir()
    shutil.copy2(fixture_root / "novel_config.yaml", target / "novel_config.yaml")
    project_meta = fixture_root / ".openwrite" / "project.yaml"
    if project_meta.is_file():
        (target / ".openwrite").mkdir()
        shutil.copy2(project_meta, target / ".openwrite" / "project.yaml")
    shutil.copytree(
        fixture_root / "data" / "novels" / "mujianzhe",
        target / "data" / "novels" / "mujianzhe",
    )
    return target


@pytest.fixture(scope="session")
def artifact_dir() -> Path:
    configured = os.getenv("OPENWRITE_LIVE_ARTIFACT_DIR", "").strip()
    if configured:
        root = Path(configured).expanduser().resolve()
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        root = REPO_ROOT / "live_test_artifacts" / stamp
    root.mkdir(parents=True, exist_ok=True)
    return root


@pytest.fixture()
def write_artifact(artifact_dir: Path):
    def write(name: str, payload: Any) -> Path:
        path = artifact_dir / name
        path.write_text(
            json.dumps(redact(payload), ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        return path

    return write


@pytest.fixture()
def live_env(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    require_live_tier("smoke")
    values = {
        "LLM_PROVIDER": "openai",
        "LLM_BASE_URL": os.getenv("OPENWRITE_LIVE_BASE_URL", "https://api.deepseek.com"),
        "LLM_MODEL": os.getenv("OPENWRITE_LIVE_MODEL", "deepseek-v4-flash"),
        "LLM_STREAM": "false",
        "LLM_TIMEOUT_SECONDS": os.getenv("OPENWRITE_LIVE_TIMEOUT_SECONDS", "180"),
        "LLM_MAX_RETRIES": os.getenv("OPENWRITE_LIVE_MAX_RETRIES", "0"),
        "LLM_MAX_TOKENS": os.getenv("OPENWRITE_LIVE_MAX_TOKENS", "8192"),
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    return values
