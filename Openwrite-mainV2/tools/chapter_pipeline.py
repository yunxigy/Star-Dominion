"""Canonical long-form chapter writing and review pipeline."""

from __future__ import annotations

import asyncio
import inspect
import os
import re
import tempfile
from contextlib import nullcontext
from dataclasses import asdict, is_dataclass
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import yaml

from tools.context_schema import normalize_context_payload
from tools.style_synthesizer import render_style_manifest_summary


def configure_writer_llm(config: Any) -> dict[str, Any]:
    """Apply operation-specific provider options and return a safe request summary."""
    provider = str(getattr(config, "provider", "") or "").lower()
    base_url = str(getattr(config, "base_url", "") or "").lower()
    model = str(getattr(config, "model", "") or "")
    requested_mode = os.getenv("OPENWRITE_WRITER_THINKING", "auto").strip().lower()
    if requested_mode not in {"auto", "enabled", "disabled"}:
        requested_mode = "auto"

    is_deepseek_chat = provider in {"openai", "custom"} and "api.deepseek.com" in base_url
    is_flash = model.lower() == "deepseek-v4-flash"
    extra = dict(getattr(config, "extra", {}) or {})
    extra_body = dict(extra.get("extra_body") or {})
    existing_thinking = extra_body.get("thinking")
    effective_mode = "provider_default"

    if isinstance(existing_thinking, dict) and existing_thinking.get("type"):
        effective_mode = str(existing_thinking["type"])
    elif is_deepseek_chat and (requested_mode != "auto" or is_flash):
        effective_mode = "disabled" if requested_mode == "auto" else requested_mode
        extra_body["thinking"] = {"type": effective_mode}
        extra["extra_body"] = extra_body
        config.extra = extra

    return {
        "provider": provider,
        "model": model,
        "max_output_tokens": int(getattr(config, "max_tokens", 0) or 0),
        "thinking": effective_mode,
    }


def apply_runtime_delta_with_fallback(
    truth_manager: Any,
    state_delta: Any,
    updates: dict[str, Any],
    *,
    chapter_id: str,
    known_entities: list[str],
) -> tuple[dict[str, Any], str]:
    """Apply a model delta, falling back only to validated additive legacy updates."""
    from tools.runtime_state import RuntimeStateError, legacy_updates_to_delta

    effective_delta = state_delta
    if not effective_delta and updates:
        effective_delta = legacy_updates_to_delta(
            updates, chapter_id=chapter_id
        ).model_dump(mode="json")
    if not effective_delta:
        return {}, ""

    try:
        truth_manager.apply_runtime_delta(
            effective_delta, known_entities=known_entities
        )
        return dict(effective_delta), ""
    except (RuntimeStateError, ValueError) as exc:
        fallback = legacy_updates_to_delta(updates, chapter_id=chapter_id)
        if not fallback.operations:
            raise
        truth_manager.apply_runtime_delta(
            fallback, known_entities=known_entities
        )
        return fallback.model_dump(mode="json"), str(exc)


def _load_config(project_root: Path) -> dict[str, Any]:
    path = project_root / "novel_config.yaml"
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return data if isinstance(data, dict) else {}


def _build_generation_context(
    builder: Any,
    chapter_id: str,
    *,
    as_of_chapter: int,
) -> Any:
    """Build historical context while preserving older builder adapters."""
    method = builder.build_generation_context
    try:
        parameters = inspect.signature(method).parameters.values()
    except (TypeError, ValueError):
        parameters = ()
    accepts_keyword = any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in parameters
    )
    accepts_as_of = accepts_keyword or any(
        parameter.name == "as_of_chapter" for parameter in parameters
    )
    if accepts_as_of:
        return method(chapter_id, as_of_chapter=as_of_chapter)
    return method(chapter_id)


def _generation_temperature(args: dict[str, Any]) -> float:
    value = args.get("temperature")
    return float(0.7 if value is None or value == "" else value)


def _chapter_number(chapter_id: Any) -> int:
    text = str(chapter_id or "").strip()
    if not text:
        return 0
    try:
        return int(text.rsplit("_", 1)[-1])
    except ValueError:
        return 0


def _chapter_path(project_root: Path, novel_id: str, chapter_id: str) -> Path:
    config = _load_config(project_root)
    arc_id = str(config.get("current_arc") or "arc_001")
    return (
        project_root
        / "data"
        / "novels"
        / novel_id
        / "data"
        / "manuscript"
        / arc_id
        / f"{chapter_id}.md"
    )


def _load_chapter(project_root: Path, novel_id: str, chapter_id: str) -> str | None:
    expected = _chapter_path(project_root, novel_id, chapter_id)
    if expected.is_file():
        return expected.read_text(encoding="utf-8")
    root = project_root / "data" / "novels" / novel_id / "data" / "manuscript"
    for pattern in (f"**/{chapter_id}.md", f"**/{chapter_id}_*.md"):
        matches = sorted(root.glob(pattern))
        if matches:
            return matches[0].read_text(encoding="utf-8")
    return None


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="wb",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    ) as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
        temporary = Path(handle.name)
    temporary.replace(path)


def _save_chapter(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
    title: str,
    content: str,
) -> Path:
    path = _chapter_path(project_root, novel_id, chapter_id)
    _atomic_write(path, f"# {title}\n\n{content}".encode())
    return path


def load_chapter(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
) -> str | None:
    """Load a committed chapter from the canonical manuscript layout."""
    return _load_chapter(Path(project_root).resolve(), novel_id, chapter_id)


def save_chapter(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
    title: str,
    content: str,
) -> Path:
    """Atomically save a chapter in the canonical manuscript layout."""
    return _save_chapter(
        Path(project_root).resolve(), novel_id, chapter_id, title, content
    )


def _restore(path: Path, previous: bytes | None) -> None:
    if previous is None:
        path.unlink(missing_ok=True)
    else:
        _atomic_write(path, previous)


def _style_profile(
    documents: Any,
    max_chars: int,
    *,
    include_fingerprint: bool = True,
) -> str:
    if not isinstance(documents, dict):
        return ""
    labels = (
        ("summary", "风格摘要", 600),
        ("prompt_section", "风格指南", 800),
        ("work.manifest", "风格合成清单", 1200),
        ("work.composed", "作品合成风格", 1200),
        ("work.scoped", "当前范围风格覆盖", 900),
        ("work.fingerprint", "作品风格指纹", 800),
        ("craft.dialogue_craft", "对话技法", 700),
        ("craft.scene_craft", "场景技法", 700),
        ("craft.rhythm_craft", "节奏技法", 700),
        ("craft.humanization", "去模板化约束", 700),
        ("craft.ai_patterns", "AI痕迹规避", 700),
        ("source.summary", "提取风格摘要", 700),
        ("source.voice", "提取叙述声音", 700),
        ("source.language", "提取语言习惯", 700),
        ("source.rhythm", "提取节奏", 700),
        ("source.dialogue", "提取对话", 700),
        ("source.consistency", "提取一致性", 700),
    )
    parts: list[str] = []
    used: set[str] = set()
    for key, label, limit in labels:
        if key == "work.fingerprint" and not include_fingerprint:
            used.add(key)
            continue
        raw = documents.get(key, "")
        value = (
            render_style_manifest_summary(raw)
            if key == "work.manifest"
            else str(raw).strip()
        )
        if value:
            used.add(key)
            parts.append(f"## {label}\n{value[:limit]}")
    for key in sorted(documents):
        value = str(documents.get(key) or "").strip()
        if key not in used and value:
            parts.append(f"## {key}\n{value[:600]}")
    return "\n\n".join(parts)[:max_chars]


def _packet_payload(packet: Any) -> dict[str, Any]:
    if isinstance(packet, dict):
        payload = dict(packet)
    elif is_dataclass(packet):
        payload = asdict(cast(Any, packet))
    else:
        payload = {
            key: getattr(packet, key)
            for key in (
                "author_intent",
                "creative_focus",
                "core_documents",
                "story_background",
                "previous_chapter_content",
                "style_documents",
                "character_documents",
                "setting_documents",
                "concept_documents",
                "continuity_documents",
                "prompt_sections",
                "foundation",
                "target_words",
            )
            if getattr(packet, key, None) not in (None, "")
        }
    if hasattr(packet, "to_markdown"):
        payload["outline"] = str(packet.to_markdown())
    return payload


def _render_outline(sections: Any) -> str:
    if not isinstance(sections, dict):
        return ""
    parts = []
    for key in ("大纲窗口", "当前章节", "戏剧位置", "本章目标", "上文"):
        value = str(sections.get(key) or "").strip()
        if value:
            parts.append(f"## {key}\n{value}")
    return "\n\n".join(parts)


def _characters(documents: Any) -> list[dict[str, str]]:
    if isinstance(documents, dict):
        return [
            {"name": str(name), "description": str(content)}
            for name, content in documents.items()
            if str(content).strip()
        ]
    if not isinstance(documents, list):
        return []
    characters: list[dict[str, str]] = []
    for index, content in enumerate(documents, start=1):
        text = str(content or "").strip()
        if not text:
            continue
        heading = next(
            (
                line.lstrip("#").strip()
                for line in text.splitlines()
                if line.strip().startswith("#")
            ),
            f"角色{index}",
        )
        characters.append({"name": heading, "description": text})
    return characters


def _context_characters(context: Any) -> list[dict[str, str]]:
    characters: list[dict[str, str]] = []
    for index, item in enumerate(getattr(context, "active_characters", []) or [], start=1):
        name = str(
            getattr(item, "name", "")
            or getattr(item, "character_id", "")
            or f"角色{index}"
        ).strip()
        if hasattr(item, "to_context_text"):
            description = str(item.to_context_text()).strip()
        elif isinstance(item, dict):
            description = str(item.get("description") or item).strip()
            name = str(item.get("name") or name).strip()
        else:
            description = str(item or "").strip()
        if description:
            characters.append({"name": name, "description": description})
    return characters


def _render_current_chapter(context: Any) -> str:
    """Render the parser-backed current chapter instead of a whole agent packet."""
    chapter = getattr(context, "current_chapter", None)
    if chapter is None:
        return ""
    parts: list[str] = []
    title = str(getattr(chapter, "title", "") or "").strip()
    if title:
        parts.append(f"# {title}")
    for label, attribute in (
        ("戏剧位置", "dramatic_position"),
        ("内容焦点", "content_focus"),
        ("情感弧线", "emotional_arc"),
    ):
        value = str(getattr(chapter, attribute, "") or "").strip()
        if value:
            parts.append(f"{label}: {value}")
    for label, attribute in (
        ("本章目标", "goals"),
        ("章内节拍", "beats"),
        ("章末悬念", "hooks"),
    ):
        values = getattr(chapter, attribute, []) or []
        normalized = [str(item).strip() for item in values if str(item).strip()]
        if normalized:
            parts.append(f"{label}:\n" + "\n".join(f"- {item}" for item in normalized))
    summary = str(getattr(chapter, "summary", "") or "").strip()
    if summary:
        parts.append("章节摘要:\n" + summary)
    return "\n\n".join(parts)


def build_writer_payload(
    *,
    context: Any,
    truth: Any,
    packet: dict[str, Any],
    guidance: str,
    target_words: int,
) -> dict[str, Any]:
    current_chapter = getattr(context, "current_chapter", None)
    payload: dict[str, Any] = {
        "target_words": target_words or getattr(context, "target_words", 0),
        "author_intent": getattr(context, "author_intent", ""),
        "creative_focus": getattr(context, "creative_focus", ""),
        "chapter_goals": getattr(context, "chapter_goals", []),
        "chapter_beats": getattr(current_chapter, "beats", []) if current_chapter else [],
        "chapter_hooks": getattr(current_chapter, "hooks", []) if current_chapter else [],
        "emotion_arc": getattr(context, "emotion_arc", ""),
        "dramatic_context": getattr(context, "dramatic_context", {}),
        "character_states": getattr(context, "character_states", ""),
        "current_state": getattr(context, "current_state", ""),
        "foreshadowing_summary": getattr(context, "foreshadowing_summary", ""),
        "ledger": getattr(context, "ledger", ""),
        "relationships": getattr(context, "relationships", "")
        or getattr(truth, "relationships", ""),
        "recent_chapters": getattr(context, "recent_text", ""),
        "semantic_references": getattr(context, "semantic_references", ""),
        "chapter_summaries": getattr(context, "chapter_summaries", ""),
        "active_characters": _context_characters(context),
    }
    chapter_outline = _render_current_chapter(context)
    if chapter_outline:
        payload["outline"] = chapter_outline
    if packet:
        sections = packet.get("prompt_sections", {})
        legacy_concepts = packet.get("concept_documents", {})
        settings = packet.get("setting_documents") or legacy_concepts
        continuity = packet.get("continuity_documents") or {}
        core_documents = packet.get("core_documents", {})
        styles = packet.get("style_documents", {})
        if not isinstance(sections, dict):
            sections = {}
        if not isinstance(settings, dict):
            settings = {}
        if not isinstance(continuity, dict):
            continuity = {}
        continuity = {
            **{
                key: legacy_concepts.get(key) or packet.get(key)
                for key in (
                    "current_state",
                    "ledger",
                    "relationships",
                    "character_states",
                    "foreshadowing_summary",
                    "pending_hooks",
                )
                if isinstance(legacy_concepts, dict)
                and (legacy_concepts.get(key) or packet.get(key))
            },
            **continuity,
        }
        if not isinstance(core_documents, dict):
            core_documents = {}
        payload["author_intent"] = str(
            packet.get("author_intent")
            or sections.get("作者意图")
            or payload["author_intent"]
        )
        payload["creative_focus"] = str(
            packet.get("creative_focus")
            or sections.get("创作罗盘（当前最高优先级）")
            or payload["creative_focus"]
        )
        payload["chapter_summaries"] = str(
            sections.get("历史章节记忆") or payload["chapter_summaries"]
        )
        if not payload.get("outline"):
            outline = _render_outline(sections) or str(packet.get("outline") or "").strip()
            if outline:
                payload["outline"] = outline
        style = _style_profile(styles, 4000, include_fingerprint=False)
        if style:
            payload["style_profile"] = style
        active = _characters(packet.get("character_documents", {}))
        if active:
            packet_by_name = {item["name"]: item for item in active}
            merged_characters = [
                packet_by_name.pop(item["name"], item)
                for item in payload.get("active_characters", [])
            ]
            merged_characters.extend(packet_by_name.values())
            payload["active_characters"] = merged_characters
        for key in ("current_state", "ledger", "relationships"):
            payload[key] = str(continuity.get(key) or payload.get(key) or "")
        payload["character_states"] = str(
            continuity.get("character_states") or payload.get("character_states") or ""
        )
        payload["foreshadowing_summary"] = str(
            continuity.get("foreshadowing_summary")
            or continuity.get("pending_hooks")
            or payload["foreshadowing_summary"]
        )
        payload["recent_chapters"] = str(packet.get("previous_chapter_content") or "")
        extra = []
        for label, value in (
            (
                "故事背景",
                core_documents.get("background") or packet.get("story_background"),
            ),
            (
                "基础设定",
                core_documents.get("foundation") or packet.get("foundation"),
            ),
            ("设定规则", settings.get("world.rules") or settings.get("world_rules")),
            ("额外要求", guidance),
        ):
            text = str(value or "").strip()
            if text:
                extra.append(f"## {label}\n{text}")
        if extra:
            payload["external_context"] = "\n\n".join(extra)
    elif guidance:
        payload["external_context"] = guidance
    return cast(
        dict[str, Any],
        normalize_context_payload(payload, include_aliases=False),
    )


def build_review_payload(
    packet: dict[str, Any],
    *,
    context: Any | None = None,
) -> dict[str, Any]:
    continuity = packet.get("continuity_documents") or packet.get("concept_documents", {})
    sections = packet.get("prompt_sections", {})
    if not isinstance(continuity, dict):
        continuity = {}
    if not isinstance(sections, dict):
        sections = {}
    characters = packet.get("character_documents", {})
    character_text = (
        "\n\n".join(str(item) for item in characters.values())
        if isinstance(characters, dict)
        else ""
    )
    outline = _render_current_chapter(context) if context is not None else ""
    if not outline:
        outline = _render_outline(sections)
    if not outline:
        section_items = packet.get("current_arc_sections")
        if isinstance(section_items, list):
            outline_parts = []
            for item in section_items:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title") or item.get("section_id") or "").strip()
                summary = str(item.get("summary") or "").strip()
                if title or summary:
                    outline_parts.append(f"## {title}\n{summary}".strip())
            outline = "\n\n".join(outline_parts)
    if not outline:
        outline = str(packet.get("outline") or "").strip()
    payload: dict[str, Any] = {
        "target_words": int(
            (getattr(context, "target_words", 0) if context is not None else 0)
            or packet.get("target_words")
            or 0
        ),
        "character_profiles": character_text,
        "current_state": str(
            continuity.get("current_state") or packet.get("current_state") or ""
        ),
        "relationships": str(
            continuity.get("relationships") or packet.get("relationships") or ""
        ),
        "author_intent": str(
            packet.get("author_intent") or sections.get("作者意图") or ""
        ),
        "creative_focus": str(
            packet.get("creative_focus")
            or sections.get("创作罗盘（当前最高优先级）")
            or ""
        ),
    }
    if context is not None:
        payload.update(
            {
                "author_intent": getattr(context, "author_intent", "")
                or payload["author_intent"],
                "creative_focus": getattr(context, "creative_focus", "")
                or payload["creative_focus"],
                "chapter_goals": getattr(context, "chapter_goals", []),
                "chapter_beats": getattr(
                    getattr(context, "current_chapter", None), "beats", []
                ),
                "chapter_hooks": getattr(
                    getattr(context, "current_chapter", None), "hooks", []
                ),
                "emotion_arc": getattr(context, "emotion_arc", ""),
                "foreshadowing_summary": getattr(
                    context, "foreshadowing_summary", ""
                ),
                "ledger": getattr(context, "ledger", ""),
                "relationships": getattr(context, "relationships", "")
                or payload["relationships"],
                "current_state": getattr(context, "current_state", "")
                or payload["current_state"],
            }
        )
    if outline:
        payload["outline"] = outline
    style = _style_profile(packet.get("style_documents", {}), 2500)
    if style:
        payload["style_profile"] = style
    previous = str(packet.get("previous_chapter_content") or "").strip()
    if previous:
        payload["recent_chapters"] = previous
    return {key: value for key, value in payload.items() if value}


def _collect_truth_updates(state_updates: Any) -> dict[str, str]:
    if not isinstance(state_updates, dict):
        return {}
    aliases = {
        "current_state": "current_state",
        "particle_ledger": "ledger",
        "ledger": "ledger",
        "character_matrix": "relationships",
        "relationships": "relationships",
    }
    return {
        aliases[key]: value
        for key, value in state_updates.items()
        if key in aliases and isinstance(value, str) and value.strip()
    }


def _sync_book_state(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
    review_passed: bool | None,
) -> None:
    from tools.agent.book_state import BookStage, BookStateStore

    store = BookStateStore(project_root, novel_id)
    state = store.load_or_create()
    if _chapter_number(chapter_id) >= _chapter_number(state.current_chapter):
        state.current_chapter = chapter_id
    if review_passed is None:
        state.stage = BookStage.REVIEW_AND_REVISE
        state.blocking_reason = "review_not_run"
        state.last_agent_action = "write_pending_review"
    elif review_passed:
        state.stage = BookStage.CHAPTER_PREFLIGHT
        state.blocking_reason = ""
        state.last_agent_action = "review_review_passed"
    else:
        state.stage = BookStage.REVIEW_AND_REVISE
        state.blocking_reason = "review_revision_requested"
        state.last_agent_action = "review_review_failed"
    store.save(state)


def _review_gate_failure(
    review: dict[str, Any],
    *,
    score_threshold: float,
) -> str:
    if not bool(review.get("passed")):
        return "review_not_passed"
    try:
        score = float(review.get("score") or 0)
    except (TypeError, ValueError):
        score = 0
    if score < score_threshold:
        return "review_score_below_threshold"
    issue_details = review.get("issue_details") or []
    if isinstance(issue_details, list):
        for issue in issue_details:
            severity = (
                issue.get("severity")
                if isinstance(issue, dict)
                else getattr(issue, "severity", "")
            )
            if str(severity or "").lower() == "critical":
                return "review_contains_critical_issue"
    return ""


def commit_chapter_candidate(
    project_root: Path,
    candidate: dict[str, Any],
    review: dict[str, Any],
    *,
    score_threshold: float = 70,
    lock_already_held: bool = False,
) -> dict[str, Any]:
    """Commit a reviewed candidate as one manuscript/truth/memory transaction."""

    from tools.chapter_memory import ChapterMemoryStore
    from tools.chapter_run_store import ChapterRunStore
    from tools.chapter_run_v2 import ChapterRunV2Store
    from tools.project_lock import ProjectBusyError, ProjectWriteLock
    from tools.truth_manager import TruthFilesManager

    block_reason = _review_gate_failure(
        review,
        score_threshold=float(score_threshold),
    )
    chapter_id = str(candidate.get("chapter_id") or "")
    if block_reason:
        return {
            "ok": False,
            "committed": False,
            "chapter_id": chapter_id,
            "code": "REVIEW_GATE_BLOCKED",
            "reason": block_reason,
            "review": review,
        }
    if not chapter_id or not re.fullmatch(r"ch_\d+", chapter_id):
        return {
            "ok": False,
            "committed": False,
            "chapter_id": chapter_id,
            "code": "INVALID_CHAPTER_ID",
            "error": "候选稿缺少有效章节 ID",
        }
    title = str(candidate.get("title") or "").strip()
    content = str(candidate.get("content") or "").strip()
    if not title or not content:
        return {
            "ok": False,
            "committed": False,
            "chapter_id": chapter_id,
            "code": "EMPTY_CANDIDATE",
            "error": "候选稿标题或正文为空",
        }

    root = Path(project_root).resolve()
    config = _load_config(root)
    novel_id = str(config.get("novel_id") or "").strip()
    if not novel_id:
        return {
            "ok": False,
            "committed": False,
            "chapter_id": chapter_id,
            "code": "INVALID_PROJECT",
            "error": "未找到项目配置",
        }
    truth_manager = TruthFilesManager(root, novel_id)
    memory = ChapterMemoryStore(root, novel_id)
    run_store = ChapterRunStore(root, novel_id)
    run_v2_store = ChapterRunV2Store(root, novel_id)
    requested_run_id = str(candidate.get("run_id") or "").strip()
    run_manifest = run_store.load(requested_run_id) if requested_run_id else None
    requested_run_v2_id = str(candidate.get("run_id_v2") or "").strip()
    run_v2_manifest = (
        run_v2_store.load(requested_run_v2_id) if requested_run_v2_id else None
    )
    updates = _collect_truth_updates(
        candidate.get("state_updates") or candidate.get("truth_updates") or {}
    )
    state_delta = candidate.get("state_delta") or {}
    if not isinstance(state_delta, dict):
        state_delta = {}
    known_entities = [
        str(item).strip()
        for item in candidate.get("known_entities", [])
        if str(item).strip()
    ]

    lock_context = (
        nullcontext()
        if lock_already_held
        else ProjectWriteLock(
            root,
            novel_id,
            operation=f"commit:{chapter_id}",
        )
    )
    try:
        with lock_context:
            snapshot_id = truth_manager.create_snapshot(
                max(_chapter_number(chapter_id) - 1, 0)
            )
            draft_path = _chapter_path(root, novel_id, chapter_id)
            memory_path = memory.path_for(chapter_id)
            history_path = truth_manager.state_history_dir / f"{chapter_id}.json"
            previous_draft = draft_path.read_bytes() if draft_path.is_file() else None
            previous_memory = memory_path.read_bytes() if memory_path.is_file() else None
            previous_history = history_path.read_bytes() if history_path.is_file() else None
            try:
                _save_chapter(root, novel_id, chapter_id, title, content)
                effective_delta, state_delta_fallback = (
                    apply_runtime_delta_with_fallback(
                        truth_manager,
                        state_delta,
                        updates,
                        chapter_id=chapter_id,
                        known_entities=known_entities,
                    )
                )
                if run_v2_manifest is not None:
                    run_v2_store.start_stage(
                        run_v2_manifest,
                        "settle",
                        prompt_version="runtime-delta-v1",
                    )
                    run_v2_store.complete_stage(
                        run_v2_manifest,
                        "settle",
                        output={
                            "state_delta": effective_delta,
                            "fallback": state_delta_fallback,
                        },
                    )
                history_updates: dict[str, Any] = dict(updates)
                if effective_delta:
                    history_updates["state_delta"] = effective_delta
                truth_manager.record_chapter_update(chapter_id, history_updates)
                memory.save(
                    chapter_id=chapter_id,
                    title=title,
                    summary=str(candidate.get("chapter_summary") or ""),
                    word_count=int(candidate.get("word_count") or 0),
                    observations=str(candidate.get("observations") or ""),
                    token_usage=dict(candidate.get("token_usage") or {}),
                )
                if run_v2_manifest is not None:
                    run_v2_store.start_stage(
                        run_v2_manifest,
                        "validate",
                        prompt_version="post-write-v1",
                    )
                    run_v2_store.complete_stage(
                        run_v2_manifest,
                        "validate",
                        output={
                            "chapter_id": chapter_id,
                            "word_count": int(candidate.get("word_count") or 0),
                        },
                    )
                    run_v2_store.start_stage(run_v2_manifest, "commit")
                    run_v2_store.complete_stage(
                        run_v2_manifest,
                        "commit",
                        output={
                            "draft_revision": run_store.text_revision(content),
                        },
                        artifact=str(draft_path),
                    )
                if run_manifest is not None and run_manifest.status == "running":
                    run_store.complete_write(
                        run_manifest,
                        draft_content=content,
                        usage=dict(candidate.get("token_usage") or {}),
                    )
                _sync_book_state(root, novel_id, chapter_id, True)
                payload: dict[str, Any] = {
                    "ok": True,
                    "committed": True,
                    "chapter_id": chapter_id,
                    "title": title,
                    "word_count": int(candidate.get("word_count") or 0),
                    "draft_path": str(draft_path),
                    "truth_updates": updates,
                    "state_delta": effective_delta,
                    "review": review,
                }
                if state_delta_fallback:
                    payload["state_delta_fallback"] = state_delta_fallback
                if run_v2_manifest is not None:
                    payload["run_id_v2"] = run_v2_manifest.run_id
                if run_manifest is not None:
                    payload["run_id"] = run_manifest.run_id
                return payload
            except Exception as exc:
                truth_manager.restore_snapshot(snapshot_id)
                _restore(draft_path, previous_draft)
                _restore(memory_path, previous_memory)
                _restore(history_path, previous_history)
                if run_v2_manifest is not None:
                    run_v2_store.invalidate_from(
                        run_v2_manifest,
                        "settle",
                        reason="transaction_rollback",
                    )
                (truth_manager.snapshots_dir / f"{snapshot_id}.json").unlink(
                    missing_ok=True
                )
                return {
                    "ok": False,
                    "committed": False,
                    "chapter_id": chapter_id,
                    "code": "COMMIT_FAILED",
                    "error": str(exc),
                }
    except ProjectBusyError as exc:
        return {
            "ok": False,
            "committed": False,
            "chapter_id": chapter_id,
            "code": "PROJECT_BUSY",
            "error": str(exc),
        }


class _TaskCancellationRequested(RuntimeError):
    pass


def _task_phase(args: dict[str, Any], phase: str, note: str = "") -> None:
    callback = args.get("_task_phase")
    if callable(callback):
        callback(phase, note)


def _raise_if_task_cancelled(args: dict[str, Any]) -> None:
    callback = args.get("_cancel_requested")
    if callable(callback) and callback():
        raise _TaskCancellationRequested("任务已取消，模型结果未提交")


def _load_resumable_writer_result(store: Any, manifest: Any) -> SimpleNamespace:
    draft_stage = manifest.stages["draft"]
    fact_stage = manifest.stages["fact_extract"]
    if draft_stage.status != "completed" or fact_stage.status != "completed":
        from tools.chapter_run_v2 import ChapterRunV2Error

        raise ChapterRunV2Error(
            "仅能从已完成 draft 与 fact_extract 的运行恢复",
            code="RUN_NOT_RESUMABLE",
        )
    draft = store.read_artifact(draft_stage.artifact)
    facts = store.read_artifact(fact_stage.artifact)
    if not isinstance(draft, dict) or not isinstance(facts, dict):
        from tools.chapter_run_v2 import ChapterRunV2Error

        raise ChapterRunV2Error("恢复 artifact 结构无效", code="INVALID_ARTIFACT")
    return SimpleNamespace(
        title=str(draft.get("title") or ""),
        content=str(draft.get("content") or ""),
        word_count=int(draft.get("word_count") or 0),
        state_updates=dict(facts.get("legacy_updates") or {}),
        state_delta=dict(facts.get("state_delta") or {}),
        chapter_summary=str(draft.get("chapter_summary") or ""),
        observations=str(draft.get("observations") or ""),
        token_usage=dict(draft.get("token_usage") or {}),
    )


def _load_generation_baseline_state(
    truth_manager: Any,
    *,
    persist: bool,
) -> Any:
    """Read runtime state for a candidate without creating a new projection."""

    runtime_state_path = truth_manager.world_dir / "runtime_state.json"
    if persist or runtime_state_path.is_file():
        return truth_manager.load_runtime_state()
    return SimpleNamespace(revision=0)


def execute_write_chapter(project_root: Path, args: dict[str, Any]) -> dict[str, Any]:
    from tools.agent import AgentContext, WriterAgent
    from tools.chapter_memory import ChapterMemoryStore
    from tools.chapter_run_store import ChapterRunStore
    from tools.chapter_run_v2 import ChapterRunV2Store
    from tools.context_builder import ContextBuilder
    from tools.llm import LLMClient, LLMConfig
    from tools.project_lock import ProjectBusyError, ProjectWriteLock
    from tools.truth_manager import TruthFilesManager
    from tools.workflow_scheduler import WorkflowScheduler

    project_root = Path(project_root).resolve()
    config = _load_config(project_root)
    if not config:
        return {"ok": False, "error": "未找到项目配置", "code": "INVALID_PROJECT"}
    novel_id = str(config.get("novel_id") or "")
    chapter_id = str(args.get("chapter_id") or "ch_001")
    packet = args.get("context_packet")
    packet = packet if isinstance(packet, dict) else {}
    target_words = int(args.get("target_words") or 0)
    persist = bool(args.get("persist", True))
    scheduler = WorkflowScheduler(project_root, novel_id)
    workflow = scheduler.load_or_create(chapter_id)
    active_stage = ""
    run_store = ChapterRunStore(project_root, novel_id)
    run_manifest = None
    run_v2_store = ChapterRunV2Store(project_root, novel_id)
    requested_run_v2_id = str(args.get("run_id_v2") or "").strip()
    run_v2_manifest = (
        run_v2_store.load(requested_run_v2_id) if requested_run_v2_id else None
    )
    if requested_run_v2_id and run_v2_manifest is None:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "未找到指定的 Chapter Run V2",
            "code": "INVALID_CHAPTER_RUN",
        }
    if run_v2_manifest is not None and run_v2_manifest.chapter_id != chapter_id:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "Chapter Run V2 与待写章节不匹配",
            "code": "INVALID_CHAPTER_RUN",
        }
    if run_v2_manifest is not None and (
        run_v2_manifest.cancel_requested or run_v2_manifest.status == "cancelled"
    ):
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "已取消的 Chapter Run V2 不能恢复",
            "code": "RUN_CANCELLED",
        }
    run_v2_active_stage = ""
    try:
        with ProjectWriteLock(project_root, novel_id, operation=f"write:{chapter_id}"):
            _task_phase(args, "reading", "读取章节上下文")
            _raise_if_task_cancelled(args)
            active_stage = "context_assembly"
            scheduler.start_stage(workflow, active_stage)
            context = _build_generation_context(
                ContextBuilder(project_root, novel_id),
                chapter_id,
                as_of_chapter=max(_chapter_number(chapter_id) - 1, 0),
            )
            truth_manager = TruthFilesManager(project_root, novel_id)
            truth = truth_manager.load_truth_files()
            baseline_state = _load_generation_baseline_state(
                truth_manager,
                persist=persist,
            )
            scheduler.complete_stage(
                workflow,
                active_stage,
                message="canonical context assembled",
                data={"chapter_id": chapter_id},
            )
            _task_phase(args, "preparing", "准备写作请求")
            _raise_if_task_cancelled(args)
            active_stage = "writing"
            scheduler.start_stage(workflow, active_stage)
            llm_config = LLMConfig.from_env()
            request_config = configure_writer_llm(llm_config)
            outline_target_words = int(getattr(context, "target_words", 0) or 0)
            effective_target_words = (
                run_v2_manifest.effective_target_words
                if run_v2_manifest is not None
                else target_words or outline_target_words or 6000
            )
            writer = WriterAgent(
                AgentContext(LLMClient(llm_config), llm_config.model, str(project_root))
            )
            writer_payload = build_writer_payload(
                context=context,
                truth=truth,
                packet=packet,
                guidance=str(args.get("guidance") or "").strip(),
                target_words=effective_target_words,
            )
            revision_draft = args.get("revision_draft")
            if isinstance(revision_draft, dict):
                writer_payload["revision_draft"] = revision_draft
            run_manifest = run_store.create(
                chapter_id,
                requested_target_words=target_words,
                outline_target_words=outline_target_words,
                effective_target_words=effective_target_words,
                provider=str(getattr(llm_config, "provider", "")),
                model=str(getattr(llm_config, "model", "")),
                context_payload={
                    **writer_payload,
                    "context_packet": packet,
                    "request_config": request_config,
                },
                baseline_state_revision=int(getattr(baseline_state, "revision", 0) or 0),
            )
            current_revisions = {
                "context": run_v2_store.content_revision(writer_payload),
                "outline": run_v2_store.content_revision(
                    writer_payload.get("chapter_goals", [])
                ),
                "runtime_state": str(
                    getattr(baseline_state, "revision", 0) or 0
                ),
                "prompt": "writer-creative-v1",
            }
            if run_v2_manifest is None:
                run_v2_manifest = run_v2_store.create(
                    chapter_id,
                    requested_target_words=target_words,
                    effective_target_words=effective_target_words,
                    provider=str(getattr(llm_config, "provider", "")),
                    model=str(getattr(llm_config, "model", "")),
                    model_profile=str(getattr(llm_config, "model", "")),
                    input_revisions=current_revisions,
                )
            else:
                stored_context = run_v2_store.read_artifact(
                    run_v2_manifest.stages["context"].artifact
                )
                if not isinstance(stored_context, dict):
                    raise ValueError("Chapter Run V2 context artifact 无效")
                comparable_context = dict(writer_payload)
                for key in ("target_words", "external_context"):
                    if key in stored_context:
                        comparable_context[key] = stored_context[key]
                    else:
                        comparable_context.pop(key, None)
                current_revisions["context"] = run_v2_store.content_revision(
                    comparable_context
                )
                stale = run_v2_store.mark_stale(
                    run_v2_manifest,
                    {
                        **run_v2_manifest.input_revisions,
                        **current_revisions,
                    },
                )
                if any(
                    stage in stale
                    for stage in ("context", "plan", "draft", "fact_extract")
                ):
                    from tools.chapter_run_v2 import ChapterRunV2Error

                    raise ChapterRunV2Error(
                        "运行输入已变化，不能复用旧草稿",
                        code="RESUME_INPUT_STALE",
                    )
                writer_payload = stored_context
            run_v2_active_stage = "context"
            if run_v2_manifest.stages["context"].status != "completed":
                run_v2_store.start_stage(
                    run_v2_manifest,
                    "context",
                    input_revisions={
                        "context": run_v2_manifest.input_revisions["context"],
                        "runtime_state": run_v2_manifest.input_revisions[
                            "runtime_state"
                        ],
                    },
                )
                context_artifact = run_v2_store.write_artifact(
                    run_v2_manifest, "context", writer_payload
                )
                run_v2_store.complete_stage(
                    run_v2_manifest,
                    "context",
                    output=writer_payload,
                    artifact=context_artifact,
                )
            run_v2_active_stage = "plan"
            if run_v2_manifest.stages["plan"].status != "completed":
                run_v2_store.start_stage(
                    run_v2_manifest,
                    "plan",
                    input_revisions={
                        "outline": run_v2_manifest.input_revisions["outline"]
                    },
                    prompt_version="writer-plan-v1",
                )
                run_v2_store.complete_stage(
                    run_v2_manifest,
                    "plan",
                    output={
                        "chapter_id": chapter_id,
                        "goals": writer_payload.get("chapter_goals", []),
                        "guidance": writer_payload.get("guidance", ""),
                    },
                )
            run_v2_active_stage = "draft"
            if run_v2_manifest.stages["draft"].status == "completed":
                result = _load_resumable_writer_result(
                    run_v2_store, run_v2_manifest
                )
            else:
                run_v2_store.start_stage(
                    run_v2_manifest,
                    "draft",
                    prompt_version="writer-creative-v1",
                    model_profile=str(getattr(llm_config, "model", "")),
                )
                _task_phase(args, "model", "生成章节草稿")
                result = asyncio.run(
                    writer.write_chapter(
                        context=writer_payload,
                        chapter_number=_chapter_number(chapter_id) or 1,
                        temperature=_generation_temperature(args),
                        target_words=writer_payload.get("target_words") or None,
                    )
                )
                _task_phase(args, "validating", "校验模型结果")
                _raise_if_task_cancelled(args)
                run_v2_store.assert_accepts_result(run_v2_manifest)
                draft_artifact = run_v2_store.write_artifact(
                    run_v2_manifest,
                    "draft",
                    {
                        "title": result.title,
                        "content": result.content,
                        "word_count": result.word_count,
                        "chapter_summary": str(
                            getattr(result, "chapter_summary", "") or ""
                        ),
                        "observations": str(
                            getattr(result, "observations", "") or ""
                        ),
                        "token_usage": dict(
                            getattr(result, "token_usage", {}) or {}
                        ),
                    },
                )
                run_v2_store.complete_stage(
                    run_v2_manifest,
                    "draft",
                    output={"title": result.title, "content": result.content},
                    artifact=draft_artifact,
                    usage=dict(getattr(result, "token_usage", {}) or {}),
                )
            _task_phase(args, "validating", "校验模型结果")
            _raise_if_task_cancelled(args)
            updates = _collect_truth_updates(getattr(result, "state_updates", {}))
            state_delta = getattr(result, "state_delta", {})
            known_entities = [
                str(item.get("name") or "").strip()
                for item in writer_payload.get("active_characters", [])
                if isinstance(item, dict) and str(item.get("name") or "").strip()
            ]
            run_v2_active_stage = "fact_extract"
            if run_v2_manifest.stages["fact_extract"].status != "completed":
                run_v2_store.start_stage(
                    run_v2_manifest,
                    "fact_extract",
                    prompt_version="runtime-delta-v1",
                )
                fact_artifact = run_v2_store.write_artifact(
                    run_v2_manifest,
                    "fact_extract",
                    {"state_delta": state_delta, "legacy_updates": updates},
                )
                run_v2_store.complete_stage(
                    run_v2_manifest,
                    "fact_extract",
                    output={"state_delta": state_delta, "legacy_updates": updates},
                    artifact=fact_artifact,
                )
            if not persist:
                run_store.complete_write(
                    run_manifest,
                    draft_content=result.content,
                    usage=dict(getattr(result, "token_usage", {}) or {}),
                )
                validation_issues = []
                for issue in getattr(result, "validation_issues", []) or []:
                    if isinstance(issue, dict):
                        validation_issues.append(dict(issue))
                    else:
                        validation_issues.append(
                            {
                                "severity": str(getattr(issue, "severity", "warning")),
                                "rule": str(getattr(issue, "rule", "")),
                                "description": str(
                                    getattr(issue, "description", "") or ""
                                ),
                                "location": str(getattr(issue, "location", "") or ""),
                            }
                        )
                candidate = {
                    "chapter_id": chapter_id,
                    "title": result.title,
                    "content": result.content,
                    "word_count": int(getattr(result, "word_count", 0) or 0),
                    "observations": str(getattr(result, "observations", "") or ""),
                    "chapter_summary": str(
                        getattr(result, "chapter_summary", "") or ""
                    ),
                    "truth_updates": updates,
                    "state_updates": dict(getattr(result, "state_updates", {}) or {}),
                    "state_delta": dict(state_delta or {}),
                    "known_entities": known_entities,
                    "validation_issues": validation_issues,
                    "token_usage": dict(getattr(result, "token_usage", {}) or {}),
                    "run_id": run_manifest.run_id,
                    "run_id_v2": run_v2_manifest.run_id,
                }
                active_stage = ""
                run_v2_active_stage = ""
                return {
                    "ok": True,
                    "committed": False,
                    "persisted": False,
                    "chapter_id": chapter_id,
                    "candidate": candidate,
                    "candidate_content": result.content,
                    "title": result.title,
                    "word_count": result.word_count,
                    "run_id": run_manifest.run_id,
                    "run_id_v2": run_v2_manifest.run_id,
                    "truth_updates": updates,
                }
            snapshot = truth_manager.create_snapshot(max(_chapter_number(chapter_id) - 1, 0))
            memory = ChapterMemoryStore(project_root, novel_id)
            draft_path = _chapter_path(project_root, novel_id, chapter_id)
            memory_path = memory.path_for(chapter_id)
            history_path = truth_manager.state_history_dir / f"{chapter_id}.json"
            previous_draft = draft_path.read_bytes() if draft_path.is_file() else None
            previous_memory = memory_path.read_bytes() if memory_path.is_file() else None
            previous_history = history_path.read_bytes() if history_path.is_file() else None
            try:
                _task_phase(args, "committing", "原子提交章节与运行态")
                _save_chapter(
                    project_root, novel_id, chapter_id, result.title, result.content
                )
                run_v2_active_stage = "settle"
                run_v2_store.start_stage(
                    run_v2_manifest,
                    "settle",
                    prompt_version="runtime-delta-v1",
                )
                state_delta, state_delta_fallback = apply_runtime_delta_with_fallback(
                    truth_manager,
                    state_delta,
                    updates,
                    chapter_id=chapter_id,
                    known_entities=known_entities,
                )
                run_v2_store.complete_stage(
                    run_v2_manifest,
                    "settle",
                    output={
                        "state_delta": state_delta,
                        "fallback": state_delta_fallback,
                    },
                )
                history_updates: dict[str, Any] = dict(updates)
                if state_delta:
                    history_updates["state_delta"] = state_delta
                truth_manager.record_chapter_update(chapter_id, history_updates)
                memory.save(
                    chapter_id=chapter_id,
                    title=result.title,
                    summary=str(getattr(result, "chapter_summary", "") or ""),
                    word_count=int(getattr(result, "word_count", 0) or 0),
                    observations=str(getattr(result, "observations", "") or ""),
                    token_usage=dict(getattr(result, "token_usage", {}) or {}),
                )
                run_v2_active_stage = "validate"
                run_v2_store.start_stage(
                    run_v2_manifest,
                    "validate",
                    prompt_version="post-write-v1",
                )
                run_v2_store.complete_stage(
                    run_v2_manifest,
                    "validate",
                    output={
                        "chapter_id": chapter_id,
                        "word_count": int(getattr(result, "word_count", 0) or 0),
                        "runtime_state": int(
                            getattr(truth_manager.load_runtime_state(), "revision", 0)
                            or 0
                        ),
                    },
                )
                run_v2_active_stage = "commit"
                run_v2_store.start_stage(run_v2_manifest, "commit")
                scheduler.complete_stage(
                    workflow,
                    active_stage,
                    message="chapter committed",
                    data={"draft_path": str(draft_path)},
                )
                _sync_book_state(project_root, novel_id, chapter_id, None)
                run_store.complete_write(
                    run_manifest,
                    draft_content=result.content,
                    usage=dict(getattr(result, "token_usage", {}) or {}),
                )
                run_v2_store.complete_stage(
                    run_v2_manifest,
                    "commit",
                    output={
                        "draft_revision": run_store.text_revision(result.content),
                        "runtime_state_revision": int(
                            getattr(truth_manager.load_runtime_state(), "revision", 0)
                            or 0
                        ),
                    },
                    artifact=str(draft_path),
                )
                active_stage = ""
                run_v2_active_stage = ""
            except Exception:
                truth_manager.restore_snapshot(snapshot)
                _restore(draft_path, previous_draft)
                _restore(memory_path, previous_memory)
                _restore(history_path, previous_history)
                if run_v2_manifest is not None:
                    run_v2_store.invalidate_from(
                        run_v2_manifest,
                        "settle",
                        reason="transaction_rollback",
                    )
                raise
            response_payload = {
                "ok": True,
                "chapter_id": chapter_id,
                "title": result.title,
                "word_count": result.word_count,
                "draft_path": str(draft_path),
                "truth_updates": updates,
                "run_id_v2": run_v2_manifest.run_id,
                "usage": dict(getattr(result, "token_usage", {}) or {}),
            }
            if state_delta_fallback:
                response_payload["state_delta"] = state_delta
                response_payload["state_delta_fallback"] = state_delta_fallback
            return response_payload
    except _TaskCancellationRequested as exc:
        if active_stage:
            scheduler.fail_stage(workflow, active_stage, str(exc))
        if run_v2_manifest is not None:
            try:
                run_v2_store.request_cancel(
                    run_v2_manifest, reason="write_cancelled"
                )
                if run_v2_active_stage:
                    run_v2_store.fail_stage(
                        run_v2_manifest,
                        run_v2_active_stage,
                        code="TASK_CANCELLED",
                        message=str(exc),
                    )
                run_v2_store.finalize_cancel(run_v2_manifest)
            except Exception:
                pass
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": str(exc),
            "code": "TASK_CANCELLED",
        }
    except ProjectBusyError as exc:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": str(exc),
            "code": "PROJECT_BUSY",
        }
    except Exception as exc:
        if run_manifest is not None:
            try:
                run_store.fail(run_manifest, stage=active_stage or "write")
            except Exception:
                pass
        if run_v2_manifest is not None and run_v2_active_stage:
            try:
                run_v2_store.fail_stage(
                    run_v2_manifest,
                    run_v2_active_stage,
                    code=str(getattr(exc, "code", "RUN_FAILED") or "RUN_FAILED"),
                    message=str(exc),
                )
            except Exception:
                pass
        if active_stage:
            scheduler.fail_stage(workflow, active_stage, str(exc))
        return {"ok": False, "chapter_id": chapter_id, "error": str(exc)}


def execute_write_and_review_chapter(
    project_root: Path,
    args: dict[str, Any],
) -> dict[str, Any]:
    """Generate a staged candidate, review it, revise it, then commit once."""

    base_args = dict(args)
    base_args["persist"] = False
    try:
        max_revisions = max(0, min(2, int(args.get("max_revisions", 2))))
    except (TypeError, ValueError):
        max_revisions = 2
    try:
        score_threshold = float(args.get("score_threshold", 70))
    except (TypeError, ValueError):
        score_threshold = 70
    revisions: list[dict[str, Any]] = []
    revision_number = 0

    while True:
        write_result = execute_write_chapter(project_root, base_args)
        if not write_result.get("ok"):
            return {
                **write_result,
                "committed": False,
                "revisions": revisions,
            }
        candidate = write_result.get("candidate")
        if not isinstance(candidate, dict):
            return {
                "ok": False,
                "committed": False,
                "chapter_id": str(base_args.get("chapter_id") or ""),
                "code": "INVALID_CANDIDATE",
                "error": "写作阶段没有返回候选稿",
                "revisions": revisions,
            }
        if bool(args.get("no_review")):
            return {
                **write_result,
                "ok": False,
                "committed": False,
                "code": "REVIEW_REQUIRED",
                "error": "候选稿尚未审查，未提交到正式正文",
                "revisions": revisions,
            }

        review_args = {
            "chapter_id": candidate["chapter_id"],
            "content": candidate["content"],
            "candidate": True,
            "run_id": candidate.get("run_id"),
            "run_id_v2": candidate.get("run_id_v2"),
            "strict": bool(args.get("strict", False)),
            "dimensions": args.get("dimensions"),
        }
        review_result = execute_review_chapter(project_root, review_args)
        if not review_result.get("ok"):
            return {
                **write_result,
                "ok": False,
                "committed": False,
                "error": str(review_result.get("error") or "审稿失败"),
                "code": str(review_result.get("code") or "REVIEW_FAILED"),
                "review": review_result,
                "revisions": revisions,
            }
        revisions.append(
            {
                "attempt": revision_number,
                "run_id": candidate.get("run_id", ""),
                "run_id_v2": candidate.get("run_id_v2", ""),
                "score": review_result.get("score", 0),
                "passed": bool(review_result.get("passed")),
                "issues": review_result.get("issues", 0),
            }
        )
        block_reason = _review_gate_failure(
            review_result,
            score_threshold=score_threshold,
        )
        if not block_reason:
            committed = commit_chapter_candidate(
                project_root,
                candidate,
                review_result,
                score_threshold=score_threshold,
            )
            return {
                **committed,
                "review": review_result,
                "revisions": revisions,
                "candidate": candidate,
            }
        if revision_number >= max_revisions:
            return {
                **write_result,
                "ok": False,
                "committed": False,
                "code": "REVIEW_GATE_BLOCKED",
                "reason": block_reason,
                "review": review_result,
                "revisions": revisions,
                "candidate": candidate,
            }

        revision_number += 1
        base_args = {
            key: value
            for key, value in base_args.items()
            if key not in {"run_id", "run_id_v2", "revision_draft"}
        }
        base_args["revision_draft"] = {
            "title": candidate.get("title", ""),
            "content": candidate.get("content", ""),
            "review": review_result,
            "issues": review_result.get("issue_details", []),
        }


def execute_review_chapter(project_root: Path, args: dict[str, Any]) -> dict[str, Any]:
    from tools.agent import AgentContext, ReviewerAgent
    from tools.chapter_assembler import ChapterAssemblerV2
    from tools.chapter_run_store import ChapterRunStore
    from tools.chapter_run_v2 import ChapterRunV2Store
    from tools.context_builder import ContextBuilder
    from tools.llm import LLMClient, LLMConfig
    from tools.project_lock import ProjectBusyError, ProjectWriteLock
    from tools.review_store import ReviewStore
    from tools.truth_manager import TruthFilesManager
    from tools.workflow_scheduler import WorkflowScheduler

    project_root = Path(project_root).resolve()
    config = _load_config(project_root)
    if not config:
        return {"ok": False, "error": "未找到项目配置", "code": "INVALID_PROJECT"}
    novel_id = str(config.get("novel_id") or "")
    chapter_id = str(args.get("chapter_id") or "ch_001")
    candidate_review = bool(args.get("candidate"))
    content_override = str(args.get("content") or "")
    dimensions = args.get("dimensions")
    if dimensions is not None and (
        not isinstance(dimensions, list)
        or any(not isinstance(item, int) or item < 1 or item > 37 for item in dimensions)
    ):
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "dimensions 必须是 1-37 的整数数组",
            "code": "INVALID_INPUT",
        }
    scheduler = WorkflowScheduler(project_root, novel_id)
    workflow = scheduler.load_or_create(chapter_id)
    run_store = ChapterRunStore(project_root, novel_id)
    run_v2_store = ChapterRunV2Store(project_root, novel_id)
    requested_run_id = str(args.get("run_id") or "").strip()
    run_manifest = (
        run_store.load(requested_run_id)
        if requested_run_id
        else run_store.latest_for_chapter(
            chapter_id, statuses={"written", "reviewed"}
        )
    )
    if requested_run_id and run_manifest is None:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "未找到指定的章节运行记录",
            "code": "INVALID_CHAPTER_RUN",
        }
    if run_manifest is not None and run_manifest.chapter_id != chapter_id:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "章节运行记录与待审章节不匹配",
            "code": "INVALID_CHAPTER_RUN",
        }
    requested_run_v2_id = str(args.get("run_id_v2") or "").strip()
    run_v2_manifest = (
        run_v2_store.load(requested_run_v2_id)
        if requested_run_v2_id
        else run_v2_store.latest_reviewable_for_chapter(chapter_id)
    )
    if requested_run_v2_id and run_v2_manifest is None:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "未找到指定的 Chapter Run V2 记录",
            "code": "INVALID_CHAPTER_RUN",
        }
    if run_v2_manifest is not None and run_v2_manifest.chapter_id != chapter_id:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "Chapter Run V2 与待审章节不匹配",
            "code": "INVALID_CHAPTER_RUN",
        }
    if requested_run_v2_id and run_v2_manifest is not None and (
        (
            candidate_review
            and run_v2_manifest.status not in {"running", "drafted", "reviewed"}
        )
        or (
            not candidate_review
            and run_v2_manifest.status not in {"committed", "reviewed"}
        )
    ):
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "指定的 Chapter Run V2 尚未提交，不能用于审稿",
            "code": "CHAPTER_RUN_NOT_REVIEWABLE",
        }
    try:
        with ProjectWriteLock(project_root, novel_id, operation=f"review:{chapter_id}"):
            _task_phase(args, "reading", "读取章节正文")
            _raise_if_task_cancelled(args)
            content = (
                content_override
                if content_override
                else _load_chapter(project_root, novel_id, chapter_id)
            )
            if not content:
                return {
                    "ok": False,
                    "error": f"未找到章节: {chapter_id}",
                    "code": "NOT_FOUND",
                }
            scheduler.start_stage(workflow, "review")
            _task_phase(args, "preparing", "组装审稿上下文")
            llm_config = LLMConfig.from_env()
            reviewer = ReviewerAgent(
                AgentContext(LLMClient(llm_config), llm_config.model, str(project_root))
            )
            packet = ChapterAssemblerV2(
                project_root=project_root,
                novel_id=novel_id,
                style_id=str(config.get("style_id") or novel_id),
            ).assemble(chapter_id)
            generation_context = _build_generation_context(
                ContextBuilder(project_root, novel_id),
                chapter_id,
                as_of_chapter=max(_chapter_number(chapter_id) - 1, 0),
            )
            review_context = build_review_payload(
                _packet_payload(packet),
                context=generation_context,
            )
            if run_manifest is not None and run_manifest.effective_target_words > 0:
                review_context["target_words"] = run_manifest.effective_target_words
            prewrite = TruthFilesManager(project_root, novel_id).load_snapshot_before(
                _chapter_number(chapter_id)
            )
            if prewrite is not None:
                review_context["current_state"] = prewrite.current_state
                review_context["relationships"] = prewrite.relationships
            if run_v2_manifest is not None:
                run_v2_store.start_stage(
                    run_v2_manifest,
                    "review",
                    input_revisions={
                        "chapter": run_v2_store.content_revision(content),
                        "review_context": run_v2_store.content_revision(review_context),
                    },
                    prompt_version="reviewer-v1",
                    model_profile=str(getattr(llm_config, "model", "")),
                )
            _task_phase(args, "model", "执行章节审稿")
            strict = bool(args.get("strict", False))
            review_store = ReviewStore(project_root, novel_id)
            _partial_batch_index = [0]

            def _on_audit_batch(
                batch_dims: list[int],
                accumulated_issues: list,
            ) -> None:
                """Persist partial review results after each LLM audit batch."""
                _partial_batch_index[0] += 1
                partial_issues: list[dict[str, Any]] = [
                    {
                        "severity": str(getattr(issue, "severity", "warning")),
                        "category": str(getattr(issue, "category", "未知")),
                        "description": str(getattr(issue, "description", "")),
                        "suggestion": str(getattr(issue, "suggestion", "")),
                        "dimension": getattr(issue, "dimension", None),
                        "evidence": {
                            "quote": str(getattr(issue, "evidence", "")),
                            "context_before": "",
                            "context_after": "",
                        },
                    }
                    for issue in accumulated_issues
                ]
                critical_count = sum(
                    1 for item in partial_issues if item["severity"] == "critical"
                )
                partial_payload = {
                    "ok": True,
                    "chapter_id": chapter_id,
                    "passed": critical_count == 0,
                    "score": max(0, 100 - critical_count * 20),
                    "issues": len(partial_issues),
                    "summary": f"审稿进行中（批次 {_partial_batch_index[0]}）",
                    "issue_details": partial_issues,
                    "run_id": run_manifest.run_id if run_manifest else "",
                    "run_id_v2": run_v2_manifest.run_id if run_v2_manifest else "",
                    "effective_target_words": int(review_context.get("target_words") or 0),
                    "partial": True,
                    "audit_batch": _partial_batch_index[0],
                    "dimensions": dimensions,
                }
                try:
                    review_store.save(chapter_id, partial_payload)
                except Exception:
                    pass

            result = asyncio.run(
                reviewer.review(
                    content=content,
                    context=review_context,
                    dimensions=dimensions,
                    strict=strict,
                    on_audit_batch_complete=_on_audit_batch,
                )
            )
            if run_v2_manifest is not None:
                run_v2_store.assert_accepts_result(run_v2_manifest)
            issues: list[dict[str, Any]] = [
                {
                    "severity": str(getattr(issue, "severity", "warning")),
                    "category": str(getattr(issue, "category", "未知")),
                    "description": str(getattr(issue, "description", "")),
                    "suggestion": str(getattr(issue, "suggestion", "")),
                    "dimension": getattr(issue, "dimension", None),
                    "evidence": {
                        "quote": str(getattr(issue, "evidence", "")),
                        "context_before": "",
                        "context_after": "",
                    },
                }
                for issue in result.issues
            ]
            payload = {
                "ok": True,
                "chapter_id": chapter_id,
                "passed": bool(result.passed),
                "score": result.score,
                "issues": len(issues),
                "summary": str(getattr(result, "summary", "") or ""),
                "issue_details": issues,
                "run_id": run_manifest.run_id if run_manifest else "",
                "run_id_v2": run_v2_manifest.run_id if run_v2_manifest else "",
                "effective_target_words": int(review_context.get("target_words") or 0),
                "token_usage": dict(getattr(result, "token_usage", {}) or {}),
                "strict": strict,
                "dimensions": dimensions,
            }
            _task_phase(args, "validating", "整理审稿问题")
            _raise_if_task_cancelled(args)
            _task_phase(args, "committing", "保存审稿结果")
            ReviewStore(project_root, novel_id).save(chapter_id, payload)
            scheduler.complete_stage(
                workflow,
                "review",
                message="chapter reviewed",
                data={
                    "passed": bool(result.passed),
                    "errors": [
                        item["description"]
                        for item in issues
                        if item["severity"].lower() == "critical"
                    ],
                    "warnings": [
                        item["description"]
                        for item in issues
                        if item["severity"].lower() != "critical"
                    ],
                },
            )
            if not candidate_review:
                _sync_book_state(project_root, novel_id, chapter_id, bool(result.passed))
            if run_manifest is not None:
                run_store.complete_review(run_manifest, review_payload=payload)
            if run_v2_manifest is not None:
                review_artifact = run_v2_store.write_artifact(
                    run_v2_manifest, "review", payload
                )
                run_v2_store.complete_stage(
                    run_v2_manifest,
                    "review",
                    output=payload,
                    artifact=review_artifact,
                )
            return payload
    except _TaskCancellationRequested as exc:
        scheduler.fail_stage(workflow, "review", str(exc))
        if run_v2_manifest is not None:
            run_v2_store.request_cancel(run_v2_manifest, reason="review_cancelled")
            run_v2_store.fail_stage(
                run_v2_manifest,
                "review",
                code="TASK_CANCELLED",
                message=str(exc),
            )
            run_v2_store.finalize_cancel(run_v2_manifest)
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": str(exc),
            "code": "TASK_CANCELLED",
        }
    except ProjectBusyError as exc:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": str(exc),
            "code": "PROJECT_BUSY",
        }
    except Exception as exc:
        scheduler.fail_stage(workflow, "review", str(exc))
        if run_v2_manifest is not None:
            try:
                run_v2_store.fail_stage(
                    run_v2_manifest,
                    "review",
                    code=str(getattr(exc, "code", "REVIEW_FAILED") or "REVIEW_FAILED"),
                    message=str(exc),
                )
            except Exception:
                pass
        return {"ok": False, "chapter_id": chapter_id, "error": str(exc)}


def execute_multi_agent_chapter(
    project_root: Path,
    args: dict[str, Any],
) -> dict[str, Any]:
    """Run the director/writer/reviewer chapter flow behind the same lock boundary."""
    from tools.agent import AgentContext, MultiAgentDirector
    from tools.llm import LLMClient, LLMConfig
    from tools.project_lock import ProjectBusyError, ProjectWriteLock
    from tools.review_store import ReviewStore
    from tools.workflow_scheduler import WorkflowScheduler

    project_root = Path(project_root).resolve()
    config = _load_config(project_root)
    if not config:
        return {"ok": False, "error": "未找到项目配置", "code": "INVALID_PROJECT"}
    novel_id = str(config.get("novel_id") or "")
    chapter_id = str(args.get("chapter_id") or "ch_001")
    dimensions = args.get("dimensions")
    if dimensions is not None and (
        not isinstance(dimensions, list)
        or any(not isinstance(item, int) or item < 1 or item > 37 for item in dimensions)
    ):
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": "dimensions 必须是 1-37 的整数数组",
            "code": "INVALID_INPUT",
        }
    scheduler = WorkflowScheduler(project_root, novel_id)
    workflow = scheduler.load_or_create(chapter_id)
    active_stage = ""
    try:
        with ProjectWriteLock(
            project_root,
            novel_id,
            operation=f"multi-write:{chapter_id}",
        ):
            llm_config = LLMConfig.from_env()
            director = MultiAgentDirector(
                AgentContext(
                    LLMClient(llm_config), llm_config.model, str(project_root)
                ),
                novel_id=novel_id,
                style_id=str(config.get("style_id") or novel_id),
            )
            # The director may still assemble and review the draft, but the
            # canonical commit is owned by the shared candidate gate below.
            director.persist_state = False
            active_stage = "context_assembly"
            scheduler.start_stage(workflow, active_stage)
            packet_markdown = ""
            packet_path = ""
            if bool(args.get("show_packet")):
                packet = director.assemble_packet(chapter_id)
                packet_markdown = packet.to_markdown()
                output_dir = (
                    Path(str(args["packet_output_dir"]))
                    if args.get("packet_output_dir")
                    else project_root
                    / "data"
                    / "novels"
                    / novel_id
                    / "data"
                    / "test_outputs"
                    / "multi_write"
                )
                output_dir.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                target = output_dir / f"{chapter_id}_packet_{stamp}.md"
                target.write_text(packet_markdown, encoding="utf-8")
                packet_path = str(target)
            scheduler.complete_stage(
                workflow,
                active_stage,
                message=(
                    "packet assembled for multi-write"
                    if packet_markdown
                    else "packet assembly delegated to multi-write director"
                ),
                data={"chapter_id": chapter_id},
            )
            active_stage = "writing"
            scheduler.start_stage(workflow, active_stage)
            director_options: dict[str, Any] = {}
            guidance = str(args.get("guidance") or "").strip()
            target_words = int(args.get("target_words") or 0)
            if guidance:
                director_options["guidance"] = guidance
            if target_words > 0:
                director_options["target_words"] = target_words
            if dimensions is not None:
                director_options["dimensions"] = dimensions
            if bool(args.get("strict", False)):
                director_options["strict"] = True
            result = asyncio.run(
                director.run(
                    chapter_id=chapter_id,
                    temperature=_generation_temperature(args),
                    run_review=not bool(args.get("no_review")),
                    **director_options,
                )
            )
            if not result.draft:
                raise RuntimeError("未生成草稿")
            scheduler.complete_stage(
                workflow,
                active_stage,
                message="candidate generated via multi-write",
                data={"chapter_id": chapter_id},
            )
            active_stage = ""
            review_payload: dict[str, Any] | None = None
            if result.review:
                issues: list[dict[str, Any]] = [
                    {
                        "severity": str(getattr(issue, "severity", "warning")),
                        "category": str(getattr(issue, "category", "未知")),
                        "description": str(getattr(issue, "description", "")),
                        "suggestion": str(getattr(issue, "suggestion", "")),
                        "dimension": getattr(issue, "dimension", None),
                        "evidence": {
                            "quote": str(getattr(issue, "evidence", "")),
                            "context_before": "",
                            "context_after": "",
                        },
                    }
                    for issue in result.review.issues
                ]
                review_payload = {
                    "ok": True,
                    "chapter_id": chapter_id,
                    "passed": bool(result.review.passed),
                    "score": result.review.score,
                    "issues": len(issues),
                    "summary": str(getattr(result.review, "summary", "") or ""),
                    "issue_details": issues,
                    "strict": bool(args.get("strict", False)),
                    "dimensions": dimensions,
                }
                ReviewStore(project_root, novel_id).save(chapter_id, review_payload)
                scheduler.start_stage(workflow, "review")
                scheduler.complete_stage(
                    workflow,
                    "review",
                    message="chapter reviewed via multi-write",
                    data={
                        "passed": bool(result.review.passed),
                        "errors": [
                            item["description"]
                            for item in issues
                            if item["severity"].lower() == "critical"
                        ],
                        "warnings": [
                            item["description"]
                            for item in issues
                            if item["severity"].lower() != "critical"
                        ],
                    },
                )
            candidate = {
                "chapter_id": chapter_id,
                "title": result.draft.title,
                "content": result.draft.content,
                "word_count": int(getattr(result.draft, "word_count", 0) or 0),
                "observations": str(
                    getattr(result.draft, "observations", "") or ""
                ),
                "chapter_summary": str(
                    getattr(result.draft, "chapter_summary", "") or ""
                ),
                "state_updates": dict(
                    getattr(result.draft, "state_updates", {}) or {}
                ),
                "state_delta": dict(
                    getattr(result.draft, "state_delta", {}) or {}
                ),
                "known_entities": [],
                "token_usage": dict(
                    getattr(result.draft, "token_usage", {}) or {}
                ),
            }
            if review_payload is None:
                return {
                    "ok": False,
                    "committed": False,
                    "chapter_id": chapter_id,
                    "title": result.draft.title,
                    "candidate": candidate,
                    "code": "REVIEW_REQUIRED",
                    "error": "候选稿尚未审查，未提交到正式正文",
                    "packet_markdown": packet_markdown,
                    "packet_path": packet_path,
                }
            score_threshold = float(args.get("score_threshold") or 70)
            block_reason = _review_gate_failure(
                review_payload,
                score_threshold=score_threshold,
            )
            if block_reason:
                return {
                    "ok": False,
                    "committed": False,
                    "chapter_id": chapter_id,
                    "title": result.draft.title,
                    "candidate": candidate,
                    "review": review_payload,
                    "code": "REVIEW_GATE_BLOCKED",
                    "reason": block_reason,
                    "packet_markdown": packet_markdown,
                    "packet_path": packet_path,
                }
            committed = commit_chapter_candidate(
                project_root,
                candidate,
                review_payload,
                score_threshold=score_threshold,
                lock_already_held=True,
            )
            return {
                **committed,
                "review": review_payload,
                "candidate": candidate,
                "applied_state_updates": dict(
                    committed.get("truth_updates")
                    or result.applied_state_updates
                    or {}
                ),
                "new_concepts": list(result.new_concepts or []),
                "packet_markdown": packet_markdown,
                "packet_path": packet_path,
            }
    except ProjectBusyError as exc:
        return {
            "ok": False,
            "chapter_id": chapter_id,
            "error": str(exc),
            "code": "PROJECT_BUSY",
        }
    except Exception as exc:
        if active_stage:
            scheduler.fail_stage(workflow, active_stage, str(exc))
        return {"ok": False, "chapter_id": chapter_id, "error": str(exc)}
