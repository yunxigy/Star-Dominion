"""Server configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ServerConfig:
    project_root: Path = field(default_factory=lambda: Path.cwd())
    host: str = "127.0.0.1"
    port: int = 8001
    cors_origins: list[str] = field(default_factory=lambda: ["https://zhumenggy.top", "http://zhumenggy.top", "http://110.40.174.239", "https://110.40.174.239"])

    @classmethod
    def from_env(cls) -> ServerConfig:
        root = os.environ.get("OPENWRITE_PROJECT_ROOT", "")
        default_origins = "https://zhumenggy.top,http://zhumenggy.top,http://110.40.174.239,https://110.40.174.239"
        cors_raw = os.environ.get("OPENWRITE_CORS_ORIGINS", default_origins)
        cors_origins = [item.strip() for item in cors_raw.split(",") if item.strip()]
        return cls(
            project_root=Path(root) if root else Path.cwd(),
            host=os.environ.get("OPENWRITE_HOST", "127.0.0.1"),
            port=int(os.environ.get("OPENWRITE_PORT", "8000")),
            cors_origins=cors_origins,
        )
