"""Shared confirmation policy for agent-initiated project mutations."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Mapping
from typing import Any

CONFIRMABLE_TOOLS = {
    "apply_reference_adoption",
    "confirm_character_draft",
    "confirm_foundation",
    "confirm_outline_edits",
    "edit_outline_structure",
    "edit_project_document",
    "edit_world_relation",
    "edit_world_relations",
    "manage_manuscript_versions",
    "promote_source_pack",
    "update_truth_file",
    "update_chapter_intervention",
}

CONFIRMATION_BLOCK_ERROR = "explicit_user_confirmation_required"
DOCUMENT_PREVIEWS_KEY = "pending_document_edit_previews"
DOCUMENT_PREVIEW_REQUEST_KEY = "pending_document_edit_preview_request"
RELATION_PREVIEW_TOKENS_KEY = "pending_relation_preview_tokens"
RELATION_PREVIEW_REQUEST_KEY = "pending_relation_preview_request"

_OVERRIDE_NEGATIVE_MARKERS = (
    "不要再确认",
    "不用确认",
    "无需确认",
    "别再确认",
    "不需要确认",
    "直接应用",
    "直接修改",
    "直接写入",
    "直接保存",
)

_NEGATIVE_MARKERS = (
    "不确认",
    "不同意",
    "先不",
    "暂不",
    "不要",
    "别改",
    "取消",
    "放弃",
)

_EXPLICIT_MARKERS = (
    "确认应用",
    "确认执行",
    "确认修改",
    "确认大纲",
    "确认关系",
    "确认恢复",
    "确认写入",
    "同意修改",
    "同意应用",
    "应用这版",
    "应用修改",
    "写入大纲",
    "写入关系",
    "保存修改",
    "保存大纲",
    "恢复这个版本",
    "采用这版",
    "就按这版",
    "提交修改",
    "直接应用",
    "直接修改",
    "直接写入",
    "无需确认",
    "不用确认",
    "可以应用",
    "可以写入",
    "可以保存",
    "apply this",
    "apply it",
    "confirm apply",
    "looks good",
)

_SHORT_CONFIRMATIONS = {
    "确认",
    "同意",
    "可以",
    "可以的",
    "应用",
    "保存",
    "提交",
    "就这样",
    "改吧",
    "好",
    "好的",
    "行",
    "行的",
    "嗯",
    "yes",
    "y",
    "ok",
    "okay",
    "apply",
    "confirm",
    "lgtm",
}

_CONFIRMATION_SCOPE_MARKERS = {
    "apply_reference_adoption": ("参考", "adoption"),
    "confirm_character_draft": ("角色", "character"),
    "confirm_foundation": ("基础设定", "foundation"),
    "confirm_outline_edits": ("大纲", "outline"),
    "edit_outline_structure": ("大纲", "结构", "outline"),
    "edit_project_document": ("文档", "资料", "文件", "document"),
    "edit_world_relation": ("关系", "relation"),
    "edit_world_relations": ("关系", "relation"),
    "manage_manuscript_versions": ("版本", "恢复", "正文", "restore"),
    "promote_source_pack": ("来源包", "晋升", "source pack"),
    "update_truth_file": ("真相", "truth"),
    "update_chapter_intervention": ("干预", "intervention"),
}


def is_explicit_mutation_confirmation(text: str) -> bool:
    """Return whether one user turn explicitly authorizes applying a preview."""

    normalized = "".join(str(text or "").strip().lower().split())
    if not normalized:
        return False
    if any(marker in normalized for marker in _OVERRIDE_NEGATIVE_MARKERS):
        return True
    if any(marker in normalized for marker in _NEGATIVE_MARKERS):
        return False
    if normalized in _SHORT_CONFIRMATIONS:
        return True
    return any(marker in normalized for marker in _EXPLICIT_MARKERS)


def is_explicit_confirmation_for_tool(text: str, tool_name: str) -> bool:
    """Interpret mixed confirmations without leaking consent across tool scopes."""
    raw = str(text or "").strip()
    markers = _CONFIRMATION_SCOPE_MARKERS.get(tool_name, ())
    if not raw or not markers:
        return is_explicit_mutation_confirmation(raw)
    clauses = [
        clause.strip()
        for clause in re.split(r"[。！？；;，,\n]+", raw)
        if clause.strip()
    ]
    scoped = [
        clause
        for clause in clauses
        if any(marker in clause.casefold() for marker in markers)
    ]
    if not scoped:
        return is_explicit_mutation_confirmation(raw)
    return any(is_explicit_mutation_confirmation(clause) for clause in scoped)


def is_confirmation_policy_block(payload: Mapping[str, Any] | None) -> bool:
    """Return whether a tool payload is a soft confirmation gate, not a hard failure."""

    if not isinstance(payload, Mapping):
        return False
    if payload.get("blocked") is True and payload.get("error") == CONFIRMATION_BLOCK_ERROR:
        return True
    return (
        payload.get("ok") is False
        and payload.get("error") == CONFIRMATION_BLOCK_ERROR
        and payload.get("next_action") == "request_mutation_confirmation"
    )


def guard_confirmable_executors(
    executors: Mapping[str, Callable[[dict[str, Any]], Any]],
    *,
    instruction: Callable[[], str],
) -> dict[str, Callable[[dict[str, Any]], Any]]:
    """Wrap mutation executors so ``confirm=true`` needs explicit user intent."""

    guarded = dict(executors)
    for name in CONFIRMABLE_TOOLS:
        executor = guarded.get(name)
        if executor is None:
            continue
        guarded[name] = _guard_executor(name, executor, instruction)
    return guarded


def remember_relation_previews(
    executors: Mapping[str, Callable[[dict[str, Any]], Any]],
    *,
    working_memory: Callable[[], dict[str, Any]],
    persist: Callable[[], None],
    instruction: Callable[[], str],
) -> dict[str, Callable[[dict[str, Any]], Any]]:
    """Persist exact batch preview tokens and inject them on a later confirmation turn."""

    wrapped = dict(executors)
    executor = wrapped.get("edit_world_relations")
    if executor is None:
        return wrapped

    def execute(args: dict[str, Any]) -> Any:
        payload = dict(args) if isinstance(args, dict) else {}
        memory = working_memory()
        pending = _relation_preview_tokens(memory.get(RELATION_PREVIEW_TOKENS_KEY))
        requested = _relation_preview_tokens(payload.get("preview_tokens"))
        single_token = str(payload.get("preview_token") or "").strip()
        if single_token:
            requested.append(single_token)
        requested = list(dict.fromkeys(requested))

        if (
            payload.get("confirm")
            and pending
            and (not requested or any(token not in pending for token in requested))
        ):
            payload.pop("relations", None)
            payload.pop("base_revisions", None)
            payload.pop("preview_token", None)
            payload.pop("preview_tokens", None)
            if len(pending) == 1:
                payload["preview_token"] = pending[0]
            else:
                payload["preview_tokens"] = pending
            requested = pending

        result = executor(payload)
        if not isinstance(result, Mapping):
            return result

        changed = False
        preview_token = str(result.get("preview_token") or "").strip()
        if result.get("ok") and not result.get("applied") and preview_token:
            request_fingerprint = hashlib.sha256(
                str(instruction() or "").strip().encode("utf-8")
            ).hexdigest()[:16]
            if memory.get(RELATION_PREVIEW_REQUEST_KEY) != request_fingerprint:
                pending = []
            if preview_token not in pending:
                pending.append(preview_token)
            memory[RELATION_PREVIEW_TOKENS_KEY] = pending[-12:]
            memory[RELATION_PREVIEW_REQUEST_KEY] = request_fingerprint
            changed = True
        elif result.get("ok") and payload.get("confirm") and requested:
            remaining = [token for token in pending if token not in requested]
            if remaining:
                memory[RELATION_PREVIEW_TOKENS_KEY] = remaining
            else:
                memory.pop(RELATION_PREVIEW_TOKENS_KEY, None)
                memory.pop(RELATION_PREVIEW_REQUEST_KEY, None)
            changed = True

        if changed:
            persist()
        return result

    wrapped["edit_world_relations"] = execute
    return wrapped


def remember_document_edit_previews(
    executors: Mapping[str, Callable[[dict[str, Any]], Any]],
    *,
    working_memory: Callable[[], dict[str, Any]],
    persist: Callable[[], None],
    instruction: Callable[[], str],
) -> dict[str, Callable[[dict[str, Any]], Any]]:
    """Persist document preview tokens and restore them on confirmation turns."""

    wrapped = dict(executors)
    executor = wrapped.get("edit_project_document")
    if executor is None:
        return wrapped

    def execute(args: dict[str, Any]) -> Any:
        payload = dict(args) if isinstance(args, dict) else {}
        memory = working_memory()
        pending = _document_preview_entries(memory.get(DOCUMENT_PREVIEWS_KEY))
        selected_token = ""
        requested_token = str(payload.get("preview_token") or "").strip()

        if payload.get("confirm") and pending:
            requested_path = str(
                payload.get("path") or payload.get("source_path") or ""
            ).strip()
            selected = next(
                (
                    entry
                    for entry in pending
                    if requested_path and entry["path"] == requested_path
                ),
                None,
            )
            if selected is None:
                selected = next(
                    (
                        entry
                        for entry in pending
                        if requested_token
                        and entry["preview_token"] == requested_token
                    ),
                    pending[0],
                )
            selected_token = selected["preview_token"]
            payload = {
                "confirm": True,
                "preview_token": selected_token,
            }

        result = executor(payload)
        if not isinstance(result, Mapping):
            return result

        changed = False
        preview_token = str(result.get("preview_token") or "").strip()
        preview_path = str(result.get("path") or "").strip()
        if result.get("ok") and not result.get("applied") and preview_token and preview_path:
            request_fingerprint = hashlib.sha256(
                str(instruction() or "").strip().encode("utf-8")
            ).hexdigest()[:16]
            if memory.get(DOCUMENT_PREVIEW_REQUEST_KEY) != request_fingerprint:
                pending = []
            pending = [entry for entry in pending if entry["path"] != preview_path]
            pending.append({"path": preview_path, "preview_token": preview_token})
            memory[DOCUMENT_PREVIEWS_KEY] = pending[-12:]
            memory[DOCUMENT_PREVIEW_REQUEST_KEY] = request_fingerprint
            changed = True
        elif result.get("ok") and payload.get("confirm") and selected_token:
            pending = [
                entry
                for entry in pending
                if entry["preview_token"] != selected_token
            ]
            if pending:
                memory[DOCUMENT_PREVIEWS_KEY] = pending
            else:
                memory.pop(DOCUMENT_PREVIEWS_KEY, None)
                memory.pop(DOCUMENT_PREVIEW_REQUEST_KEY, None)
            changed = True

        if changed:
            persist()
        if result.get("ok") and payload.get("confirm") and pending:
            return {
                **result,
                "pending_document_previews": len(pending),
                "next_action": "继续逐个确认剩余文档预览。",
            }
        return result

    wrapped["edit_project_document"] = execute
    return wrapped


def _relation_preview_tokens(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(
        dict.fromkeys(
            str(item).strip()
            for item in value
            if str(item or "").strip()
        )
    )


def _document_preview_entries(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    entries: list[dict[str, str]] = []
    seen_paths: set[str] = set()
    for item in reversed(value):
        if not isinstance(item, Mapping):
            continue
        path = str(item.get("path") or "").strip()
        token = str(item.get("preview_token") or "").strip()
        if not path or not token or path in seen_paths:
            continue
        entries.append({"path": path, "preview_token": token})
        seen_paths.add(path)
    entries.reverse()
    return entries


def _guard_executor(
    name: str,
    executor: Callable[[dict[str, Any]], Any],
    instruction: Callable[[], str],
) -> Callable[[dict[str, Any]], Any]:
    def guarded(args: dict[str, Any]) -> Any:
        payload = args if isinstance(args, dict) else {}
        applying = name in {
            "apply_reference_adoption",
            "confirm_character_draft",
            "confirm_foundation",
            "confirm_outline_edits",
            "promote_source_pack",
        } or bool(payload.get("confirm"))
        if not applying or is_explicit_confirmation_for_tool(instruction(), name):
            return executor(payload)
        return {
            "action": name,
            "ok": False,
            "applied": False,
            "blocked": True,
            "error": CONFIRMATION_BLOCK_ERROR,
            "message": "尚未收到用户对本次 diff 的明确应用指令，项目文件未修改。",
            "next_action": "request_mutation_confirmation",
        }

    return guarded
