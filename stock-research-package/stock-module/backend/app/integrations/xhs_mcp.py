"""Read-only stdio client for the pinned Playwright Xiaohongshu MCP."""

from collections.abc import Mapping
import json
import os
from pathlib import Path
from typing import Any


ALLOWED_XHS_TOOLS = {
    "xhs_check_auth_status",
    "xhs_add_account",
    "xhs_check_login_session",
    "xhs_search",
    "xhs_get_note",
}


def parse_mcp_result(result: Any) -> dict[str, Any]:
    structured = getattr(result, "structuredContent", None) or getattr(
        result, "structured_content", None
    )
    if isinstance(structured, Mapping):
        return dict(structured)
    for item in getattr(result, "content", []):
        text = getattr(item, "text", None)
        if not text:
            continue
        try:
            decoded = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(decoded, Mapping):
            return dict(decoded)
        if isinstance(decoded, list):
            return {"items": decoded}
    return {}


class XhsMcpClient:
    def __init__(
        self,
        command: list[str],
        *,
        data_dir: str | Path,
        environment: Mapping[str, str] | None = None,
    ) -> None:
        if not command:
            raise ValueError("小红书 MCP 启动命令不能为空")
        self._command = command
        self._data_dir = Path(data_dir)
        self._environment = dict(environment or {})

    async def call(self, tool: str, arguments: dict) -> dict[str, Any]:
        if tool not in ALLOWED_XHS_TOOLS:
            raise PermissionError(f"禁止调用小红书写工具：{tool}")

        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        self._data_dir.mkdir(parents=True, exist_ok=True)
        parameters = StdioServerParameters(
            command=self._command[0],
            args=self._command[1:],
            env={
                **os.environ,
                **self._environment,
                "XHS_MCP_DATA_DIR": str(self._data_dir),
            },
        )
        async with stdio_client(parameters) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                return parse_mcp_result(await session.call_tool(tool, arguments))
