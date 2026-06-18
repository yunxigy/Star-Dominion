"""Server configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


_DEFAULT_ORIGINS = [
    "https://zhumenggy.top",
    "http://zhumenggy.top",
    "http://110.40.174.239",
    "https://110.40.174.239",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:8000",
    "http://localhost:8001",
]


@dataclass
class ServerConfig:
    project_root: Path = field(default_factory=lambda: Path.cwd())
    host: str = "127.0.0.1"
    port: int = 8001
    cors_origins: list[str] = field(default_factory=lambda: list(_DEFAULT_ORIGINS))

    @classmethod
    def from_env(cls) -> ServerConfig:
        root = os.environ.get("OPENWRITE_PROJECT_ROOT", "")
        cors_raw = os.environ.get("OPENWRITE_CORS_ORIGINS", "")
        if cors_raw.strip():
            cors_origins = [item.strip() for item in cors_raw.split(",") if item.strip()]
        else:
            cors_origins = list(_DEFAULT_ORIGINS)
        return cls(
            project_root=Path(root) if root else Path.cwd(),
            host=os.environ.get("OPENWRITE_HOST", "127.0.0.1"),
            port=int(os.environ.get("OPENWRITE_PORT", "8001")),
            cors_origins=cors_origins,
        )
