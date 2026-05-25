"""FastAPI dependency injection."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from server.config import ServerConfig
from server.services.tool_executor_service import ToolExecutorService


@lru_cache
def get_config() -> ServerConfig:
    return ServerConfig.from_env()


def get_project_root() -> Path:
    return get_config().project_root


@lru_cache
def get_tool_executor_service() -> ToolExecutorService:
    return ToolExecutorService(get_project_root())
