"""Environment-backed configuration for the research reports service."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    timezone: ZoneInfo
    site_auth_url: str
    site_auth_internal_key: str = field(repr=False)
    github_token: str | None = field(default=None, repr=False)
    ai_provider: str = "siliconflow"
    ai_base_url: str = "https://api.siliconflow.cn/v1"
    ai_model: str = "deepseek-v4-flash"
    ai_profile_id: str | None = None
    ai_api_key: str | None = field(default=None, repr=False)
    ai_timeout_seconds: float = 45.0
    host: str = "127.0.0.1"
    port: int = 8009

    @property
    def database_path(self) -> Path:
        return self.data_dir / "reports.db"

    @classmethod
    def from_env(cls, environment: Mapping[str, str] | None = None) -> "Settings":
        values = os.environ if environment is None else environment
        key = values.get("SITE_AUTH_INTERNAL_KEY", "").strip()
        if len(key) < 32:
            raise ValueError("SITE_AUTH_INTERNAL_KEY must contain at least 32 characters")

        timezone_name = values.get("RESEARCH_REPORTS_TIMEZONE", "Asia/Shanghai").strip()
        try:
            timezone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"Unknown RESEARCH_REPORTS_TIMEZONE: {timezone_name}") from exc

        default_data_dir = Path(__file__).resolve().parents[1] / "data"
        data_dir = Path(
            values.get("RESEARCH_REPORTS_DATA_DIR", str(default_data_dir))
        ).resolve()
        auth_url = values.get(
            "RESEARCH_REPORTS_SITE_AUTH_URL",
            values.get("SITE_AUTH_URL", "http://127.0.0.1:8000"),
        ).strip().rstrip("/")
        if not auth_url:
            raise ValueError("RESEARCH_REPORTS_SITE_AUTH_URL is required")

        token = values.get("GITHUB_TOKEN", "").strip() or None
        ai_provider = values.get("RESEARCH_REPORTS_AI_PROVIDER", "siliconflow").strip()
        ai_base_url = values.get("RESEARCH_REPORTS_AI_BASE_URL", "https://api.siliconflow.cn/v1").strip().rstrip("/")
        ai_model = values.get("RESEARCH_REPORTS_AI_MODEL", "deepseek-v4-flash").strip()
        ai_api_key = values.get("SILICONFLOW_API_KEY", "").strip() or None
        ai_profile_id: str | None = values.get("RESEARCH_REPORTS_AI_PROFILE_ID", "").strip() or None
        if not ai_api_key:
            profile = _select_platform_profile(values, ai_profile_id)
            if profile is not None:
                ai_profile_id = str(profile["id"])
                ai_provider = str(profile["provider"])
                ai_base_url = str(profile["base_url"]).rstrip("/")
                ai_api_key = values.get(str(profile["api_key_env"]), "").strip() or None
                if not values.get("RESEARCH_REPORTS_AI_TIMEOUT_SECONDS", "").strip():
                    timeout_from_profile = profile.get("timeout_seconds")
                else:
                    timeout_from_profile = None
            else:
                timeout_from_profile = None
        else:
            timeout_from_profile = None
        try:
            timeout_value = values.get("RESEARCH_REPORTS_AI_TIMEOUT_SECONDS", "") or (
                str(timeout_from_profile) if timeout_from_profile is not None else "45"
            )
            ai_timeout_seconds = float(timeout_value)
        except ValueError as exc:
            raise ValueError("RESEARCH_REPORTS_AI_TIMEOUT_SECONDS must be a number") from exc
        port_text = values.get("RESEARCH_REPORTS_PORT", "8009").strip()
        try:
            port = int(port_text)
        except ValueError as exc:
            raise ValueError("RESEARCH_REPORTS_PORT must be an integer") from exc
        if not 1 <= port <= 65535:
            raise ValueError("RESEARCH_REPORTS_PORT must be between 1 and 65535")

        return cls(
            data_dir=data_dir,
            timezone=timezone,
            site_auth_url=auth_url,
            site_auth_internal_key=key,
            github_token=token,
            ai_provider=ai_provider,
            ai_base_url=ai_base_url,
            ai_model=ai_model,
            ai_profile_id=ai_profile_id,
            ai_api_key=ai_api_key,
            ai_timeout_seconds=ai_timeout_seconds,
            host=values.get("RESEARCH_REPORTS_HOST", "127.0.0.1").strip(),
            port=port,
        )


def _select_platform_profile(
    values: Mapping[str, str], requested_id: str | None
) -> dict[str, object] | None:
    encoded = values.get("STOCK_PLATFORM_MODEL_PROFILES_JSON", "").strip()
    if not encoded:
        return None
    try:
        raw = json.loads(encoded)
    except json.JSONDecodeError as exc:
        raise ValueError("STOCK_PLATFORM_MODEL_PROFILES_JSON must be valid JSON") from exc
    if not isinstance(raw, list):
        raise ValueError("STOCK_PLATFORM_MODEL_PROFILES_JSON must be a JSON array")
    profiles = [item for item in raw if isinstance(item, dict) and item.get("enabled", True)]
    if requested_id:
        profiles = [item for item in profiles if item.get("id") == requested_id]
    for profile in profiles:
        if profile.get("provider") == "siliconflow":
            return profile
    return profiles[0] if profiles else None
