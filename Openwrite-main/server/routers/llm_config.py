"""LLM configuration routes — read/write .env file."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from server.dependencies import get_project_root

router = APIRouter(tags=["llm-config"])

_ENV_KEYS = [
    "LLM_PROVIDER",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_TEMPERATURE",
    "LLM_MAX_TOKENS",
    "LLM_STREAM",
    "LLM_API_FORMAT",
    "LLM_TIMEOUT_SECONDS",
    "LLM_MAX_RETRIES",
]

_DEFAULTS = {
    "LLM_PROVIDER": "openai",
    "LLM_API_KEY": "",
    "LLM_BASE_URL": "https://api.openai.com/v1",
    "LLM_MODEL": "gpt-4o-mini",
    "LLM_TEMPERATURE": "0.7",
    "LLM_MAX_TOKENS": "24000",
    "LLM_STREAM": "true",
    "LLM_API_FORMAT": "chat",
    "LLM_TIMEOUT_SECONDS": "120",
    "LLM_MAX_RETRIES": "3",
}


def _read_env_file(project_root: Path) -> dict[str, str]:
    env_path = project_root / ".env"
    result: dict[str, str] = {}
    if not env_path.exists():
        return result
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            result[key] = value
    return result


def _write_env_file(project_root: Path, updates: dict[str, str]) -> None:
    env_path = project_root / ".env"
    existing = _read_env_file(project_root)
    existing.update(updates)
    lines = []
    for key in _ENV_KEYS:
        if key in existing:
            lines.append(f"{key}={existing[key]}")
    # preserve any extra keys not in our known list
    for key, value in existing.items():
        if key not in _ENV_KEYS:
            lines.append(f"{key}={value}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


class LLMConfigResponse(BaseModel):
    provider: str = "openai"
    api_key_set: bool = False
    api_key_masked: str = ""
    base_url: str = ""
    model: str = ""
    temperature: float = 0.7
    max_tokens: int = 24000
    stream: bool = True
    api_format: str = "chat"
    timeout_seconds: float = 120.0
    max_retries: int = 3


class LLMConfigUpdate(BaseModel):
    provider: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    stream: bool | None = None
    api_format: str | None = None
    timeout_seconds: float | None = None
    max_retries: int | None = None


def _mask_key(key: str) -> str:
    if not key or len(key) < 8:
        return "****" if key else ""
    return key[:4] + "*" * (len(key) - 8) + key[-4:]


@router.get("/llm-config", response_model=LLMConfigResponse)
async def get_llm_config(project_root: Path = Depends(get_project_root)):
    env_file = _read_env_file(project_root)

    def _get(key: str) -> str:
        return env_file.get(key, os.getenv(key, _DEFAULTS.get(key, "")))

    api_key = _get("LLM_API_KEY")
    return LLMConfigResponse(
        provider=_get("LLM_PROVIDER"),
        api_key_set=bool(api_key),
        api_key_masked=_mask_key(api_key),
        base_url=_get("LLM_BASE_URL"),
        model=_get("LLM_MODEL"),
        temperature=float(_get("LLM_TEMPERATURE")),
        max_tokens=int(_get("LLM_MAX_TOKENS")),
        stream=_get("LLM_STREAM").lower() == "true",
        api_format=_get("LLM_API_FORMAT"),
        timeout_seconds=float(_get("LLM_TIMEOUT_SECONDS")),
        max_retries=int(_get("LLM_MAX_RETRIES")),
    )


@router.put("/llm-config", response_model=LLMConfigResponse)
async def update_llm_config(
    update: LLMConfigUpdate,
    project_root: Path = Depends(get_project_root),
):
    updates: dict[str, str] = {}
    field_map = {
        "provider": "LLM_PROVIDER",
        "api_key": "LLM_API_KEY",
        "base_url": "LLM_BASE_URL",
        "model": "LLM_MODEL",
        "temperature": "LLM_TEMPERATURE",
        "max_tokens": "LLM_MAX_TOKENS",
        "stream": "LLM_STREAM",
        "api_format": "LLM_API_FORMAT",
        "timeout_seconds": "LLM_TIMEOUT_SECONDS",
        "max_retries": "LLM_MAX_RETRIES",
    }
    for field_name, env_key in field_map.items():
        val = getattr(update, field_name, None)
        if val is not None:
            updates[env_key] = str(val).lower() if isinstance(val, bool) else str(val)
            # also set in current process so changes take effect without restart
            os.environ[env_key] = updates[env_key]

    _write_env_file(project_root, updates)

    return await get_llm_config(project_root=project_root)
