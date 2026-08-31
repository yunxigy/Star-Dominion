"""Traceable manifest for assembled writing context."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

SECTION_SOURCES: dict[str, tuple[int, list[str]]] = {
    "author_intent": (3, ["src/story/author_intent.md"]),
    "creative_focus": (1, ["src/story/current_focus.md"]),
    "story_background": (3, ["src/story/background.md", "src/story/foundation.md"]),
    "core_documents": (3, ["src/story/background.md", "src/story/foundation.md"]),
    "historical_arc_summaries": (4, ["src/outline.md"]),
    "current_arc_sections": (2, ["src/outline.md"]),
    "previous_chapter_content": (0, ["data/manuscript/"]),
    "protagonist_state": (1, ["data/world/current_state.md"]),
    "current_state": (3, ["data/world/current_state.md"]),
    "ledger": (3, ["data/world/ledger.md"]),
    "relationships": (3, ["data/world/relationships.md"]),
    "character_documents": (2, ["src/characters/"]),
    "concept_documents": (2, ["src/world/"]),
    "setting_documents": (2, ["src/world/", "src/progression/"]),
    "continuity_documents": (
        3,
        ["data/world/", "data/foreshadowing/"],
    ),
    "style_documents": (3, ["data/style/", "craft/"]),
}

CANONICAL_SECTION_ALIASES: dict[str, tuple[str, ...]] = {
    "core_documents": ("story_background",),
    "setting_documents": ("concept_documents",),
    "continuity_documents": ("current_state", "ledger", "relationships"),
}


def build_context_manifest(novel_root: Path, packet: dict[str, Any]) -> dict[str, Any]:
    """Describe context layers, provenance, size and stable revisions."""
    root = Path(novel_root).resolve()
    items: list[dict[str, Any]] = []
    suppressed_aliases = {
        alias
        for canonical, aliases in CANONICAL_SECTION_ALIASES.items()
        if _render(packet.get(canonical)).strip()
        for alias in aliases
    }
    for section, (level, sources) in SECTION_SOURCES.items():
        if section in suppressed_aliases:
            continue
        value = packet.get(section)
        rendered = _render(value)
        if not rendered.strip():
            continue
        resolved = _resolve_sources(root, sources)
        items.append(
            {
                "section": section,
                "level": level,
                "characters": len(rendered),
                "estimated_tokens": max(1, int(len(rendered) / 1.5)),
                "sources": resolved,
                "revision": hashlib.sha256(rendered.encode("utf-8")).hexdigest()[:16],
            }
        )
    revision_seed = "\n".join(
        f"{item['section']}:{item['revision']}" for item in items
    )
    return {
        "schema_version": 2,
        "strategy": "hierarchical-provenance-v1",
        "revision": hashlib.sha256(revision_seed.encode("utf-8")).hexdigest()[:16],
        "estimated_tokens": sum(int(item["estimated_tokens"]) for item in items),
        "items": items,
    }


def _render(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            rendered = _render(item)
            if rendered.strip():
                parts.append(f"{key}: {rendered}")
        return "\n".join(parts)
    if isinstance(value, list):
        return "\n".join(
            rendered
            for item in value
            if (rendered := _render(item)).strip()
        )
    return str(value or "")


def _resolve_sources(root: Path, sources: list[str]) -> list[dict[str, Any]]:
    resolved: list[dict[str, Any]] = []
    for relative in sources:
        path = root / relative
        if relative.endswith("/"):
            exists = path.is_dir()
            revision = "directory" if exists else "missing"
        else:
            exists = path.is_file()
            revision = _file_revision(path) if exists else "missing"
        resolved.append({"path": relative, "exists": exists, "revision": revision})
    return resolved


def _file_revision(path: Path) -> str:
    try:
        content = path.read_bytes()
    except OSError:
        return "unreadable"
    return hashlib.sha256(content).hexdigest()[:16]
