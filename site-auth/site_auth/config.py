"""Environment-backed configuration for the authentication service."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import os
from pathlib import Path


def _parse_bool(value: str, *, name: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


@dataclass(frozen=True, slots=True)
class Settings:
    """Validated service configuration with no built-in credential defaults."""

    data_dir: Path
    internal_service_key: str
    allowed_origins: tuple[str, ...]
    cookie_secure: bool

    @property
    def database_path(self) -> Path:
        return self.data_dir / "auth.db"

    @classmethod
    def from_env(
        cls,
        environment: Mapping[str, str] | None = None,
    ) -> "Settings":
        values = os.environ if environment is None else environment
        internal_key = values.get("SITE_AUTH_INTERNAL_KEY", "").strip()
        if len(internal_key) < 32:
            raise ValueError("SITE_AUTH_INTERNAL_KEY must contain at least 32 characters")

        origins = tuple(
            origin.strip().rstrip("/")
            for origin in values.get("SITE_AUTH_ALLOWED_ORIGINS", "").split(",")
            if origin.strip()
        )
        if not origins:
            raise ValueError("SITE_AUTH_ALLOWED_ORIGINS must contain at least one origin")

        default_data_dir = Path(__file__).resolve().parents[1] / "data"
        data_dir = Path(values.get("SITE_AUTH_DATA_DIR", default_data_dir)).resolve()
        cookie_secure = _parse_bool(
            values.get("SITE_AUTH_COOKIE_SECURE", "true"),
            name="SITE_AUTH_COOKIE_SECURE",
        )
        return cls(
            data_dir=data_dir,
            internal_service_key=internal_key,
            allowed_origins=origins,
            cookie_secure=cookie_secure,
        )
