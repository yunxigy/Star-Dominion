"""Shared novel-agent action surface for CLI, Studio, Goethe and Dante."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from tools.runtime_skills import resolve_runtime

from .tool_runtime import build_tool_executors


def _load_novel_id(project_root: Path, requested: str | None = None) -> str:
    if requested:
        return requested
    config_path = project_root / "novel_config.yaml"
    if not config_path.exists():
        return "current"
    data = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    return str(data.get("novel_id") or "current")


def _read_text_arg(args: dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        value = args.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return default


def _positive_int(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def _float_value(value: Any, *, default: float) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _missing_required(action: str, field_name: str) -> dict[str, object]:
    return {
        "action": action,
        "ok": False,
        "blocked": True,
        "error": f"missing_{field_name}",
        "message": f"缺少必需参数: {field_name}",
        field_name: "",
    }


def build_dante_tool_layers(project_root: Path) -> dict[str, object]:
    """Build Dante's direct and high-level action tools without a CLI dependency."""
    from .dante_actions import DanteActionAdapter
    from .orchestrator import OpenWriteOrchestrator
    from .toolkits import DANTE_ACTION_TOOLKIT, DANTE_DIRECT_TOOLKIT

    project_root = Path(project_root).resolve()
    tool_executors = build_tool_executors(project_root)
    orchestrator = OpenWriteOrchestrator(
        project_root=project_root,
        novel_id=_load_novel_id(project_root),
        tool_executors=tool_executors,
    )
    adapter = DanteActionAdapter(orchestrator)
    action_tool_executors: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
        "summarize_ideation": lambda args: adapter.summarize_ideation(),
        "confirm_ideation_summary": lambda args: adapter.confirm_ideation_summary(
            _read_text_arg(args, "text", "confirmation", default="这个汇总可以")
        ),
        "generate_outline_draft": lambda args: adapter.generate_outline_draft(
            _read_text_arg(args, "request_text", "text", default="帮我生成一份四级大纲")
        ),
        "confirm_outline_scope": lambda args: adapter.confirm_outline_scope(),
        "run_chapter_preflight": lambda args: (
            adapter.run_chapter_preflight(
                _read_text_arg(args, "chapter_id", "chapter")
            )
            if _read_text_arg(args, "chapter_id", "chapter")
            else _missing_required("run_chapter_preflight", "chapter_id")
        ),
        "delegate_chapter_write": lambda args: (
            adapter.delegate_chapter_write(
                _read_text_arg(args, "chapter_id", "chapter"),
                guidance=_read_text_arg(args, "guidance", "text"),
                target_words=_positive_int(args.get("target_words")),
                temperature=_float_value(args.get("temperature"), default=0.7),
            )
            if _read_text_arg(args, "chapter_id", "chapter")
            else _missing_required("delegate_chapter_write", "chapter_id")
        ),
        "delegate_chapter_review": lambda args: (
            adapter.delegate_chapter_review(
                _read_text_arg(args, "chapter_id", "chapter"),
                guidance=_read_text_arg(args, "guidance", "text"),
                strict=bool(args.get("strict", False)),
                dimensions=(
                    args.get("dimensions")
                    if isinstance(args.get("dimensions"), list)
                    else None
                ),
            )
            if _read_text_arg(args, "chapter_id", "chapter")
            else _missing_required("delegate_chapter_review", "chapter_id")
        ),
    }
    baseline = set(DANTE_DIRECT_TOOLKIT) | set(DANTE_ACTION_TOOLKIT)
    runtime_resolution = resolve_runtime(
        project_root,
        agent="dante",
        task="chapter.write",
        base_tools=baseline,
    )
    allowed = set(runtime_resolution.allowed_tools)
    direct_toolkit = set(DANTE_DIRECT_TOOLKIT) & allowed
    action_toolkit = set(DANTE_ACTION_TOOLKIT) & allowed
    if allowed != baseline:
        action_tool_executors = {
            name: executor
            for name, executor in action_tool_executors.items()
            if name in action_toolkit
        }
    return {
        "tool_executors": tool_executors,
        "direct_toolkit": (
            DANTE_DIRECT_TOOLKIT
            if direct_toolkit == set(DANTE_DIRECT_TOOLKIT)
            else direct_toolkit
        ),
        "action_toolkit": (
            DANTE_ACTION_TOOLKIT
            if action_toolkit == set(DANTE_ACTION_TOOLKIT)
            else action_toolkit
        ),
        "direct_tool_executors": {
            name: tool_executors[name]
            for name in direct_toolkit
            if name in tool_executors
        },
        "action_tool_executors": action_tool_executors,
        "runtime_resolution": runtime_resolution,
    }


def build_goethe_tool_layers(
    project_root: Path,
    novel_id: str | None = None,
) -> dict[str, object]:
    """Build Goethe's novel-planning tools from the same action surface."""
    from .goethe_actions import GoetheActionAdapter, GoethePlanningRuntime
    from .toolkits import GOETHE_ACTION_TOOLKIT, GOETHE_DIRECT_TOOLKIT

    project_root = Path(project_root).resolve()
    tool_executors = build_tool_executors(project_root)
    runtime = GoethePlanningRuntime(
        project_root=project_root,
        novel_id=_load_novel_id(project_root, novel_id),
        tool_executors=tool_executors,
    )
    adapter = GoetheActionAdapter(runtime)
    action_tool_executors: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
        "summarize_ideation": lambda args: adapter.summarize_ideation(),
        "confirm_ideation_summary": lambda args: adapter.confirm_ideation_summary(
            _read_text_arg(args, "text", "confirmation", default="这个汇总可以")
        ),
        "generate_foundation_draft": lambda args: (
            adapter.generate_foundation_draft(
                _read_text_arg(args, "request_text", "text", "brief")
            )
            if _read_text_arg(args, "request_text", "text", "brief")
            else _missing_required("generate_foundation_draft", "request_text")
        ),
        "confirm_foundation": lambda args: adapter.confirm_foundation(),
        "generate_character_draft": lambda args: (
            adapter.generate_character_draft(
                _read_text_arg(args, "request_text", "text", "brief")
            )
            if _read_text_arg(args, "request_text", "text", "brief")
            else _missing_required("generate_character_draft", "request_text")
        ),
        "confirm_character_draft": lambda args: (
            adapter.confirm_character_draft(
                _read_text_arg(args, "character_id", "id")
            )
            if _read_text_arg(args, "character_id", "id")
            else _missing_required("confirm_character_draft", "character_id")
        ),
        "generate_outline_draft": lambda args: (
            adapter.generate_outline_draft(
                _read_text_arg(args, "request_text", "text", "brief")
            )
            if _read_text_arg(args, "request_text", "text", "brief")
            else _missing_required("generate_outline_draft", "request_text")
        ),
        "read_outline": lambda args: adapter.read_outline(
            query=_read_text_arg(args, "query"),
            start_line=_positive_int(args.get("start_line")),
            end_line=_positive_int(args.get("end_line")),
        ),
        "stage_outline_edits": lambda args: adapter.stage_outline_edits(
            base_revision=_read_text_arg(args, "base_revision", "revision"),
            edits=args.get("edits") if isinstance(args.get("edits"), list) else [],
            batch_label=_read_text_arg(args, "batch_label"),
            final_batch=bool(args.get("final_batch", True)),
        ),
        "confirm_outline_edits": lambda args: adapter.confirm_outline_edits(),
        "discard_outline_edits": lambda args: adapter.discard_outline_edits(),
        "extract_style_source": lambda args: adapter.extract_style_source(
            _read_text_arg(args, "source_id", "source_name"),
            _read_text_arg(args, "source", "source_file", "text"),
        ),
        "extract_setting_source": lambda args: adapter.extract_setting_source(
            _read_text_arg(args, "source_id", "source_name"),
            _read_text_arg(args, "source", "source_file", "text"),
        ),
        "review_source_pack": lambda args: (
            adapter.review_source_pack(
                _read_text_arg(args, "source_id", "source_name")
            )
            if _read_text_arg(args, "source_id", "source_name")
            else _missing_required("review_source_pack", "source_id")
        ),
        "promote_source_pack": lambda args: (
            adapter.promote_source_pack(
                _read_text_arg(args, "source_id", "source_name"),
                target=_read_text_arg(args, "target", default="all"),
            )
            if _read_text_arg(args, "source_id", "source_name")
            else _missing_required("promote_source_pack", "source_id")
        ),
        "list_reference_library": lambda args: adapter.list_reference_library(),
        "review_reference_source": lambda args: (
            adapter.review_reference_source(_read_text_arg(args, "source_id"))
            if _read_text_arg(args, "source_id")
            else _missing_required("review_reference_source", "source_id")
        ),
        "review_reference_profile": lambda args: (
            adapter.review_reference_profile(_read_text_arg(args, "profile_id"))
            if _read_text_arg(args, "profile_id")
            else _missing_required("review_reference_profile", "profile_id")
        ),
        "preview_reference_adoption": lambda args: adapter.preview_reference_adoption(
            _read_text_arg(args, "profile_id"),
            args.get("selections") if isinstance(args.get("selections"), list) else [],
        ),
        "apply_reference_adoption": lambda args: adapter.apply_reference_adoption(
            _read_text_arg(args, "preview_id"),
            confirm=bool(args.get("confirm")),
        ),
        "prepare_dante_handoff": lambda args: adapter.prepare_dante_handoff(),
    }
    baseline = set(GOETHE_DIRECT_TOOLKIT) | set(GOETHE_ACTION_TOOLKIT)
    runtime_resolution = resolve_runtime(
        project_root,
        agent="goethe",
        task="planning",
        base_tools=baseline,
    )
    allowed = set(runtime_resolution.allowed_tools)
    direct_toolkit = set(GOETHE_DIRECT_TOOLKIT) & allowed
    action_toolkit = set(GOETHE_ACTION_TOOLKIT) & allowed
    if allowed != baseline:
        action_tool_executors = {
            name: executor
            for name, executor in action_tool_executors.items()
            if name in action_toolkit
        }
    direct_tool_executors = {
        name: tool_executors[name]
        for name in direct_toolkit
        if name in tool_executors
    }
    if "read_project_document" in direct_tool_executors:
        project_document_reader = direct_tool_executors["read_project_document"]

        def read_goethe_project_document(args: dict[str, Any]) -> dict[str, Any]:
            requested_path = _read_text_arg(args, "path").replace("\\", "/")
            if requested_path == "src/outline.md" or requested_path.endswith(
                "/src/outline.md"
            ):
                payload = adapter.read_outline()
                payload["redirected_from"] = "read_project_document"
                payload["message"] = (
                    "已自动改用 read_outline，返回当前可编辑版本；存在分批草稿时内容来自 "
                    "pending draft，而不是 canonical 大纲。"
                )
                return payload
            return project_document_reader(args)

        direct_tool_executors["read_project_document"] = read_goethe_project_document
    return {
        "tool_executors": tool_executors,
        "direct_toolkit": (
            GOETHE_DIRECT_TOOLKIT
            if direct_toolkit == set(GOETHE_DIRECT_TOOLKIT)
            else direct_toolkit
        ),
        "action_toolkit": (
            GOETHE_ACTION_TOOLKIT
            if action_toolkit == set(GOETHE_ACTION_TOOLKIT)
            else action_toolkit
        ),
        "direct_tool_executors": direct_tool_executors,
        "action_tool_executors": action_tool_executors,
        "runtime_resolution": runtime_resolution,
    }
