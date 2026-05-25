"""Async wrapper for build_cli_tool_executors."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)


class ToolExecutorService:
    """Wraps the synchronous dict->dict tool executors as async calls."""

    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root
        self._executors: dict[str, Callable[[dict], dict]] | None = None

    def _ensure_loaded(self) -> dict[str, Callable[[dict], dict]]:
        if self._executors is None:
            from tools.cli import build_cli_tool_executors

            self._executors = build_cli_tool_executors(self.project_root)
            logger.info("Loaded %d tool executors", len(self._executors))
        return self._executors

    def list_tools(self) -> list[str]:
        return list(self._ensure_loaded().keys())

    async def execute(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        executors = self._ensure_loaded()
        executor = executors.get(tool_name)
        if executor is None:
            return {"error": f"Unknown tool: {tool_name}"}
        try:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, executor, args)
        except Exception as e:
            logger.exception("Tool %s failed", tool_name)
            return {"error": str(e)}

    def execute_sync(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        executors = self._ensure_loaded()
        executor = executors.get(tool_name)
        if executor is None:
            return {"error": f"Unknown tool: {tool_name}"}
        try:
            return executor(args)
        except Exception as e:
            logger.exception("Tool %s failed", tool_name)
            return {"error": str(e)}
