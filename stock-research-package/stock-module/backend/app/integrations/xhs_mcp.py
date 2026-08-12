"""Read-only stdio client for the pinned Playwright Xiaohongshu MCP."""

from collections.abc import Mapping
import json
import os
from pathlib import Path
import re
from typing import Any


ALLOWED_XHS_TOOLS = {
    "xhs_check_auth_status",
    "xhs_add_account",
    "xhs_check_login_session",
    "xhs_search",
    "xhs_get_note",
}


def translate_rednote_call(tool: str, arguments: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
    """Translate the app's stable XHS contract to the fallback RedNote MCP contract."""
    if tool == "xhs_search":
        keyword = str(arguments.get("keyword", "")).strip()
        return "search_notes", {"keywords": keyword, "limit": int(arguments.get("limit", 10))}
    if tool == "xhs_get_note":
        return "get_note_content", {"url": str(arguments.get("url", ""))}
    if tool == "xhs_add_account":
        return "login", {}
    raise ValueError(f"RedNote MCP does not expose {tool}")


def parse_rednote_text(text: str) -> list[dict[str, Any]]:
    """Parse the text blocks emitted by the lightweight rednote-mcp package."""
    key_map = {
        "标题": "title", "鏍囬": "title", "title": "title",
        "作者": "author", "浣滆€?": "author", "author": "author",
        "内容": "content", "鍐呭": "content", "content": "content",
        "点赞": "likes", "鐐硅禐": "likes", "likes": "likes",
        "评论": "comments", "璇勮": "comments", "comments": "comments",
        "链接": "url", "閾炬帴": "url", "url": "url",
        "发布时间": "publish_time", "publish_time": "publish_time",
        "published_at": "published_at", "created_at": "created_at",
        "create_time": "created_at", "time": "time",
    }
    items: list[dict[str, Any]] = []
    for block in re.split(r"\n-{3,}\s*\n?", text):
        item: dict[str, Any] = {}
        for line in block.splitlines():
            if ":" not in line and "：" not in line:
                continue
            key, value = re.split(r"[:：]", line, maxsplit=1)
            field = key_map.get(key.strip())
            if not field:
                continue
            value = value.strip()
            if field in {"likes", "comments"}:
                match = re.search(r"\d+(?:\.\d+)?", value)
                item[field] = int(float(match.group(0))) if match else 0
            else:
                item[field] = value
        if item.get("title") or item.get("url"):
            items.append(item)
    return items


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
        command_text = " ".join(command).lower()
        self._provider = "rednote" if "rednote-mcp" in command_text else "legacy"
        self._profile_dir = self._data_dir / "profile"
        self._cookie_path = self._profile_dir / ".mcp" / "rednote" / "cookies.json"

    def _cookie_status(self) -> dict[str, Any]:
        if not self._cookie_path.exists():
            return {"status": "unauthenticated", "authenticated": False}
        try:
            cookies = json.loads(self._cookie_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"status": "unauthenticated", "authenticated": False}
        authenticated = isinstance(cookies, list) and bool(cookies)
        return {
            "status": "authenticated" if authenticated else "unauthenticated",
            "authenticated": authenticated,
        }

    async def call(self, tool: str, arguments: dict) -> dict[str, Any]:
        if tool not in ALLOWED_XHS_TOOLS:
            raise PermissionError(f"禁止调用小红书写工具：{tool}")

        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._profile_dir.mkdir(parents=True, exist_ok=True)
        if self._provider == "rednote" and tool in {"xhs_check_auth_status", "xhs_check_login_session"}:
            status = self._cookie_status()
            if tool == "xhs_check_login_session":
                return {**status, "session_id": arguments.get("sessionId")}
            return status
        parameters = StdioServerParameters(
            command=self._command[0],
            args=self._command[1:],
            env={
                **os.environ,
                **self._environment,
                "XHS_MCP_DATA_DIR": str(self._data_dir),
                "USERPROFILE": str(self._profile_dir),
                "HOME": str(self._profile_dir),
            },
        )
        async with stdio_client(parameters) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                remote_tool = tool
                remote_arguments = arguments
                if self._provider == "rednote":
                    remote_tool, remote_arguments = translate_rednote_call(tool, arguments)
                result = await session.call_tool(remote_tool, remote_arguments)
                if self._provider == "rednote" and remote_tool == "search_notes":
                    text = "\n".join(
                        str(getattr(item, "text", ""))
                        for item in getattr(result, "content", [])
                        if getattr(item, "text", None)
                    )
                    return {"items": parse_rednote_text(text)}
                parsed = parse_mcp_result(result)
                if self._provider == "rednote" and remote_tool == "login":
                    return {"status": "authenticated", "authenticated": True, "message": "小红书登录流程已完成"}
                return parsed
