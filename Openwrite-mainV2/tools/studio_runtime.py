"""Runtime helpers shared by the Studio application and adapters."""

from __future__ import annotations

import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from markdown_it import MarkdownIt

DEBUG_ENV = "OPENWRITE_DEBUG"
DEBUG_LOGGER_NAMES = (
    "tools.studio",
    "tools.studio_http",
    "tools.agent.react",
    "tools.agent.dante",
    "tools.agent.dante_actions",
    "tools.agent.orchestrator",
    "tools.goethe",
)
AGENT_TOOL_LABELS = {
    "get_status": "读取作品状态",
    "get_context": "组装章节上下文",
    "get_character_state": "查询人物当前状态",
    "query_library": "浏览资料目录",
    "search_project": "搜索作品资料",
    "read_project_document": "读取项目文档",
    "edit_project_document": "预览或写入文档修改",
    "get_outline_structure": "读取大纲结构",
    "edit_outline_structure": "预览或写入大纲修改",
    "get_world_relations": "读取关系图谱",
    "search_relation_targets": "搜索关系目标",
    "edit_world_relation": "预览或写入关系",
    "edit_world_relations": "批量处理关系",
    "run_chapter_preflight": "执行章节预检",
    "delegate_chapter_write": "生成并结算章节",
    "delegate_chapter_review": "审查章节",
}
CHAT_MARKDOWN = MarkdownIt(
    "commonmark",
    {
        "html": False,
        "linkify": False,
        "typographer": False,
    },
)


def truthy_env(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "debug"}


def debug_log_path(project_root: Path, novel_root: Path, initialized: bool) -> Path:
    if initialized:
        return novel_root / "data" / "logs" / "studio-debug.log"
    return project_root / ".openwrite" / "logs" / "studio-debug.log"


def configure_debug_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    for logger_name in DEBUG_LOGGER_NAMES:
        target = logging.getLogger(logger_name)
        target.setLevel(logging.DEBUG)
        target.propagate = False
        for handler in list(target.handlers):
            if getattr(handler, "_openwrite_studio_debug", False):
                target.removeHandler(handler)
                handler.close()
        handler = RotatingFileHandler(
            log_path,
            maxBytes=2_000_000,
            backupCount=3,
            encoding="utf-8",
        )
        handler._openwrite_studio_debug = True  # type: ignore[attr-defined]
        handler.setLevel(logging.DEBUG)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
        target.addHandler(handler)


def sanitize_debug_payload(value: Any, *, depth: int = 0) -> Any:
    if depth > 4:
        return "<max-depth>"
    if isinstance(value, dict):
        sanitized = {}
        for key, item in value.items():
            key_text = str(key)
            lowered = key_text.lower()
            if any(
                token in lowered
                for token in (
                    "api_key",
                    "apikey",
                    "authorization",
                    "password",
                    "secret",
                    "token",
                )
            ):
                sanitized[key_text] = "<redacted>"
            else:
                sanitized[key_text] = sanitize_debug_payload(item, depth=depth + 1)
        return sanitized
    if isinstance(value, list):
        return [sanitize_debug_payload(item, depth=depth + 1) for item in value[:20]]
    if isinstance(value, tuple):
        return tuple(sanitize_debug_payload(item, depth=depth + 1) for item in value[:20])
    if isinstance(value, str):
        compact = value.replace("\n", "\\n")
        return compact[:800] + ("..." if len(compact) > 800 else "")
    return value


def debug_json(payload: dict[str, Any]) -> str:
    return json.dumps(
        sanitize_debug_payload(payload),
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )


def render_chat_markdown(content: str) -> str:
    """Render model-authored CommonMark without allowing raw HTML."""
    return CHAT_MARKDOWN.render(content)
