"""Canonical library taxonomy shared by Studio, search, context, and agents.

The on-disk layout remains backward compatible (``src/story`` and
``src/world``), while creator-facing surfaces use the clearer logical scopes
``core``, ``characters``, ``settings``, and ``continuity``.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from tools.asset_ids import is_safe_asset_id
from tools.frontmatter import parse_toml_front_matter

LIBRARY_SCOPES = ("core", "characters", "settings")
CANONICAL_SEARCH_SCOPES = {
    "all",
    "outline",
    "core",
    "characters",
    "settings",
    "continuity",
    "chapters",
    "sources",
}
LEGACY_SCOPE_ALIASES = {
    "story": "core",
    "world": "settings",
    "assets": "characters",
}
SEARCH_SCOPES = CANONICAL_SEARCH_SCOPES | set(LEGACY_SCOPE_ALIASES)

SCOPE_LABELS = {
    "all": "全部资料",
    "outline": "大纲",
    "core": "作品核心",
    "characters": "角色",
    "settings": "设定",
    "continuity": "连续性",
    "chapters": "正文",
    "sources": "参考资料",
}

CATEGORY_LABELS = {
    "core_promise": "创作承诺",
    "core_premise": "故事基础",
    "core_reference": "补充资料",
    "character_main": "主角",
    "character_core": "核心角色",
    "character_opposition": "对手",
    "character_supporting": "配角",
    "setting_places": "地点",
    "setting_factions": "组织与势力",
    "setting_systems": "规则与体系",
    "setting_history": "历史与事件",
    "setting_terms": "物品与术语",
    "setting_threats": "威胁与异常",
    "setting_concepts": "其他概念",
    "continuity_state": "当前状态",
    "continuity_relations": "关系与资源",
    "continuity_clues": "伏笔与线索",
    "source_text": "参考原文",
    "source_analysis": "拆书分析",
}

CATEGORY_ORDER = {key: index for index, key in enumerate(CATEGORY_LABELS)}


@dataclass(frozen=True)
class LibraryDescriptor:
    scope: str
    scope_label: str
    category: str
    category_label: str
    asset_kind: str = ""
    asset_id: str = ""
    structured: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "scope": self.scope,
            "scope_label": self.scope_label,
            "category": self.category,
            "category_label": self.category_label,
            "asset_kind": self.asset_kind,
            "asset_id": self.asset_id,
            "structured": self.structured,
        }


def normalize_search_scope(value: str) -> str:
    """Return a canonical search scope while accepting legacy API values."""
    scope = str(value or "all").strip().lower() or "all"
    scope = LEGACY_SCOPE_ALIASES.get(scope, scope)
    if scope not in CANONICAL_SEARCH_SCOPES:
        raise ValueError("搜索范围无效")
    return scope


def scope_for_path(relative: str) -> str:
    """Map a novel-relative source path to its logical information scope."""
    path = str(relative or "").replace("\\", "/").lstrip("./")
    if path == "src/outline.md":
        return "outline"
    if path.startswith("data/manuscript/"):
        return "chapters"
    if path.startswith(("data/sources/", "data/style/")):
        return "sources"
    if path.startswith(("data/world/", "data/foreshadowing/")):
        return "continuity"
    if path.startswith("src/characters/"):
        return "characters"
    if path.startswith(("src/world/", "src/progression/")):
        return "settings"
    if path.startswith("src/story/"):
        return "core"
    return "core"


def describe_document(relative: str, content: str = "") -> LibraryDescriptor:
    """Describe one canonical document using the shared taxonomy."""
    scope = scope_for_path(relative)
    metadata = _metadata(content)
    path = Path(relative)
    asset_id = str(metadata.get("id") or path.stem).strip()
    valid_asset_id = bool(metadata) and _is_structured_asset_id(asset_id)

    if scope == "core":
        category = _core_category(path)
        return _descriptor(scope, category)
    if scope == "characters":
        category = _character_category(metadata)
        return _descriptor(
            scope,
            category,
            asset_kind="character" if valid_asset_id else "",
            asset_id=asset_id if valid_asset_id else "",
            structured=valid_asset_id,
        )
    if scope == "settings":
        category = _settings_category(relative, metadata, content)
        asset_kind = ""
        if _is_structured_world_path(relative):
            asset_kind = "world"
        elif relative.startswith("src/progression/"):
            asset_kind = "progression"
        return _descriptor(
            scope,
            category,
            asset_kind=asset_kind if valid_asset_id else "",
            asset_id=asset_id if asset_kind and valid_asset_id else "",
            structured=bool(asset_kind and valid_asset_id),
        )
    if scope == "continuity":
        return _descriptor(scope, _continuity_category(relative))
    if scope == "sources":
        category = "source_analysis" if "/analysis_v2/" in relative else "source_text"
        return _descriptor(scope, category)
    return _descriptor(scope, "core_reference")


def _is_structured_asset_id(value: str) -> bool:
    return is_safe_asset_id(value)


def _is_structured_world_path(relative: str) -> bool:
    path = str(relative or "").replace("\\", "/").strip("/")
    if path.startswith("src/world/entities/"):
        return True
    parts = path.split("/")
    return len(parts) == 3 and parts[:2] == ["src", "world"] and parts[2].lower().endswith(".md")


def iter_library_paths(novel_root: Path) -> Iterable[Path]:
    """Yield canonical library assets, including structured YAML settings."""
    root = Path(novel_root)
    specifications = (
        (root / "src" / "story", {".md"}),
        (root / "src" / "characters", {".md"}),
        (root / "src" / "world", {".md"}),
        (root / "src" / "progression", {".yaml", ".yml"}),
    )
    for directory, suffixes in specifications:
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            if path.is_file() and not path.is_symlink() and path.suffix.lower() in suffixes:
                yield path


def query_library(
    novel_root: Path,
    *,
    scope: str = "all",
    category: str = "",
    query: str = "",
    limit: int = 80,
) -> dict[str, Any]:
    """Return a bounded structured catalog for Agent and application tools."""
    normalized_scope = normalize_search_scope(scope)
    if normalized_scope not in {*LIBRARY_SCOPES, "all"}:
        raise ValueError("资料目录仅支持 core/characters/settings/all")
    clean_category = str(category or "").strip()
    terms = [item.casefold() for item in re.split(r"\s+", str(query or "").strip()) if item]
    items: list[dict[str, Any]] = []
    root = Path(novel_root).resolve()
    for path in iter_library_paths(root):
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        relative = path.resolve().relative_to(root).as_posix()
        descriptor = describe_document(relative, content)
        if normalized_scope != "all" and descriptor.scope != normalized_scope:
            continue
        if clean_category and descriptor.category != clean_category:
            continue
        title = document_title(path, content)
        haystack = "\n".join(
            (title, relative, descriptor.category_label, content[:4000])
        ).casefold()
        if terms and not all(term in haystack for term in terms):
            continue
        items.append(
            {
                "path": relative,
                "title": title,
                **descriptor.to_dict(),
                "summary": document_summary(path, content),
            }
        )
    items.sort(
        key=lambda item: (
            LIBRARY_SCOPES.index(item["scope"]),
            CATEGORY_ORDER.get(item["category"], len(CATEGORY_ORDER)),
            str(item["title"]).casefold(),
        )
    )
    safe_limit = max(1, min(int(limit or 80), 200))
    return {
        "scope": normalized_scope,
        "scope_label": SCOPE_LABELS[normalized_scope],
        "category": clean_category,
        "query": str(query or "").strip(),
        "count": len(items),
        "items": items[:safe_limit],
        "categories": [
            {"id": key, "label": label}
            for key, label in CATEGORY_LABELS.items()
            if any(item["category"] == key for item in items)
        ],
    }


def _descriptor(
    scope: str,
    category: str,
    *,
    asset_kind: str = "",
    asset_id: str = "",
    structured: bool = False,
) -> LibraryDescriptor:
    return LibraryDescriptor(
        scope=scope,
        scope_label=SCOPE_LABELS.get(scope, scope),
        category=category,
        category_label=CATEGORY_LABELS.get(category, "未分类"),
        asset_kind=asset_kind,
        asset_id=asset_id,
        structured=structured,
    )


def _metadata(content: str) -> dict[str, Any]:
    if not str(content or "").lstrip().startswith("+++"):
        return {}
    try:
        metadata, _ = parse_toml_front_matter(content)
    except (TypeError, ValueError):
        return {}
    return metadata if isinstance(metadata, dict) else {}


def _core_category(path: Path) -> str:
    if path.stem in {"author_intent", "current_focus"}:
        return "core_promise"
    if path.stem in {"background", "foundation"}:
        return "core_premise"
    return "core_reference"


def _character_category(metadata: dict[str, Any]) -> str:
    tier = str(metadata.get("tier") or metadata.get("role") or "").casefold()
    tags = " ".join(str(item) for item in metadata.get("tags", [])).casefold()
    value = f"{tier} {tags}"
    if any(marker in value for marker in ("主角", "protagonist", "lead")):
        return "character_main"
    if any(marker in value for marker in ("反派", "对手", "antagonist", "opposition")):
        return "character_opposition"
    if any(marker in value for marker in ("核心", "重要", "major", "core")):
        return "character_core"
    return "character_supporting"


def _settings_category(
    relative: str,
    metadata: dict[str, Any],
    content: str,
) -> str:
    path = Path(relative)
    if path.name == "rules.md" or relative.startswith("src/progression/"):
        return "setting_systems"
    if path.name == "timeline.md":
        return "setting_history"
    if path.name == "terminology.md":
        return "setting_terms"

    value = " ".join(
        (
            relative,
            str(metadata.get("kind") or ""),
            str(metadata.get("type") or ""),
            str(metadata.get("subtype") or ""),
            " ".join(str(item) for item in metadata.get("tags", [])),
            _legacy_entity_type(content),
        )
    ).casefold()
    groups = (
        (
            "setting_places",
            ("location", "place", "domain", "region", "地点", "场所", "区域", "冠域"),
        ),
        (
            "setting_factions",
            ("faction", "organization", "power", "group", "势力", "组织", "门派", "联邦", "帝国"),
        ),
        ("setting_history", ("history", "timeline", "event", "历史", "时间线", "事件", "前史")),
        (
            "setting_terms",
            ("item", "artifact", "terminology", "object", "物品", "道具", "术语", "遗物"),
        ),
        (
            "setting_threats",
            (
                "antagonist",
                "threat",
                "disaster",
                "monster",
                "反派",
                "威胁",
                "灾难",
                "异常",
                "神性生物",
            ),
        ),
        (
            "setting_systems",
            (
                "system",
                "rule",
                "path",
                "technique",
                "ability",
                "规则",
                "体系",
                "能力",
                "修行",
                "机制",
            ),
        ),
    )
    for category, markers in groups:
        if any(marker in value for marker in markers):
            return category
    return "setting_concepts"


def _continuity_category(relative: str) -> str:
    name = Path(relative).stem.casefold()
    if "foreshadow" in relative.casefold() or name in {"dag", "clues"}:
        return "continuity_clues"
    if name in {"relationships", "ledger"}:
        return "continuity_relations"
    return "continuity_state"


def _legacy_entity_type(content: str) -> str:
    match = re.search(r"^>\s*([^|\n]+)", content, re.MULTILINE)
    return match.group(1).strip() if match else ""


def document_title(path: Path, content: str) -> str:
    """Return the same creator-facing title across catalog and search surfaces."""
    match = re.search(r"^#\s+(.+?)\s*$", content, re.MULTILINE)
    if match:
        return match.group(1).strip()
    metadata = _metadata(content) or _yaml_metadata(path, content)
    return str(metadata.get("name") or path.stem.replace("_", " ")).strip()


def document_summary(path: Path, content: str) -> str:
    """Extract a short summary from Markdown front matter or structured YAML."""
    metadata = _metadata(content) or _yaml_metadata(path, content)
    summary = str(metadata.get("summary") or "").strip()
    if summary:
        return summary[:240]
    clean = re.sub(r"(?ms)^\+\+\+.*?^\+\+\+\s*", "", content)
    for raw_line in clean.splitlines():
        line = raw_line.strip()
        if line and not line.startswith(("#", ">", "|", "- ", "* ")):
            return line[:240]
    return ""


def _yaml_metadata(path: Path, content: str) -> dict[str, Any]:
    if path.suffix.lower() not in {".yaml", ".yml"}:
        return {}
    try:
        payload = yaml.safe_load(content) or {}
    except yaml.YAMLError:
        return {}
    return payload if isinstance(payload, dict) else {}
