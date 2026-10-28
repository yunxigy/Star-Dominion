from __future__ import annotations

import tempfile
from ipaddress import IPv4Network, IPv6Network, ip_network
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class VideoSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VIDEO_",
        case_sensitive=False,
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    signing_secret: SecretStr | None = None
    temp_dir: Path = Path(tempfile.gettempdir()) / "sd-video-downloader"
    cookie_secure: bool = True
    cookie_name: str = "sd_video_session"
    cookie_path: str = "/video-api/"
    session_ttl_seconds: int = Field(default=3600, gt=0)
    parse_token_ttl_seconds: int = Field(default=300, gt=0)
    output_ttl_seconds: int = Field(default=1800, gt=0)
    max_duration_seconds: int = Field(default=7200, gt=0)
    max_file_bytes: int = Field(default=2_147_483_648, gt=0)
    global_download_concurrency: int = Field(default=2, gt=0)
    per_ip_active_downloads: int = Field(default=1, gt=0)
    parse_rate_limit: int = Field(default=10, gt=0)
    parse_rate_window_seconds: int = Field(default=60, gt=0)
    download_rate_limit: int = Field(default=3, gt=0)
    download_rate_window_seconds: int = Field(default=3600, gt=0)
    max_redirects: int = Field(default=3, ge=0, le=10)
    max_queue_size: int = Field(default=8, gt=0)
    trusted_proxies: str = "127.0.0.1/32,::1/128"
    douyin_cookie_file: Path | None = None
    ffmpeg_bin: str = "ffmpeg"

    @field_validator("signing_secret", "douyin_cookie_file", mode="before")
    @classmethod
    def blank_optional_values_are_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("cookie_path")
    @classmethod
    def cookie_path_is_absolute(cls, value: str) -> str:
        if not value.startswith("/"):
            raise ValueError("cookie_path must start with /")
        return value

    @model_validator(mode="after")
    def validate_safe_runtime_settings(self) -> "VideoSettings":
        resolved_temp = self.temp_dir.expanduser().resolve()
        root = Path(resolved_temp.anchor).resolve()
        forbidden = {root, Path.cwd().resolve(), Path.home().resolve()}
        if resolved_temp in forbidden:
            raise ValueError("temp_dir must be a dedicated temporary subdirectory")
        self.temp_dir = resolved_temp

        if self.environment == "production":
            secret = self.signing_secret.get_secret_value() if self.signing_secret else ""
            if len(secret) < 32:
                raise ValueError("production signing_secret must contain at least 32 characters")
            if not self.cookie_secure:
                raise ValueError("production cookies must be secure")
        return self

    @property
    def trusted_proxy_networks(self) -> tuple[IPv4Network | IPv6Network, ...]:
        values = [item.strip() for item in self.trusted_proxies.split(",") if item.strip()]
        return tuple(ip_network(item, strict=False) for item in values)
