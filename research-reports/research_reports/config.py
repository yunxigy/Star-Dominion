"""Environment-backed configuration for the research reports service."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
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
            host=values.get("RESEARCH_REPORTS_HOST", "127.0.0.1").strip(),
            port=port,
        )
