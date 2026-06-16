"""角色关系图工具 — 从角色文件和关系数据构建图。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


def _parse_character_frontmatter(content: str) -> dict[str, Any]:
    """解析角色文件的 TOML frontmatter。"""
    meta: dict[str, Any] = {}
    if content.startswith("+++"):
        parts = content.split("+++", 2)
        if len(parts) >= 3:
            try:
                import tomllib
                meta = tomllib.loads(parts[1].strip())
            except Exception:
                # Fallback: try YAML
                try:
                    import yaml
                    meta = yaml.safe_load(parts[1].strip()) or {}
                except Exception:
                    pass
    elif content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                import yaml
                meta = yaml.safe_load(parts[1].strip()) or {}
            except Exception:
                pass
    return meta


def build_character_graph(project_root: Path, novel_id: str) -> dict[str, Any]:
    """构建角色关系图数据。

    Returns:
        {
            "nodes": [{"id": str, "name": str, "tier": str, "summary": str}],
            "edges": [{"source": str, "target": str, "label": str}],
        }
    """
    chars_dir = project_root / "data" / "novels" / novel_id / "src" / "characters"
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    node_ids: set[str] = set()

    if not chars_dir.exists():
        return {"nodes": nodes, "edges": edges}

    # Parse all character files
    characters: dict[str, dict[str, Any]] = {}
    for f in sorted(chars_dir.glob("*.md")):
        content = f.read_text(encoding="utf-8")
        meta = _parse_character_frontmatter(content)

        char_id = meta.get("id", f.stem)
        name = meta.get("name", f.stem)
        tier = meta.get("tier", "")
        summary = meta.get("summary", "")
        related = meta.get("related", [])

        characters[char_id] = {
            "id": char_id,
            "name": name,
            "tier": tier,
            "summary": summary[:100] if summary else "",
            "related": related,
        }

        nodes.append({
            "id": char_id,
            "name": name,
            "tier": tier,
            "summary": summary[:100] if summary else "",
        })
        node_ids.add(char_id)

    # Build edges from related fields
    for char_id, char_data in characters.items():
        for rel in char_data.get("related", []):
            if isinstance(rel, str):
                # Simple string reference
                target = rel.strip()
                if target in node_ids and target != char_id:
                    edges.append({
                        "source": char_id,
                        "target": target,
                        "label": "",
                    })
            elif isinstance(rel, dict):
                # Dict with target and label
                target = rel.get("target", rel.get("name", "")).strip()
                label = rel.get("label", rel.get("relation", ""))
                if target in node_ids and target != char_id:
                    edges.append({
                        "source": char_id,
                        "target": target,
                        "label": label,
                    })

    # Parse relationships.md for additional edges
    rel_path = project_root / "data" / "novels" / novel_id / "data" / "relationships.md"
    if rel_path.exists():
        content = rel_path.read_text(encoding="utf-8")
        # Extract relationship pairs from text
        # Pattern: "A与B" or "A-B" or "A、B"
        for line in content.split("\n"):
            line = line.strip()
            if not line or line.startswith("+"):
                continue
            # Try to find character names mentioned together
            mentioned = [nid for nid in node_ids if nid in line]
            if len(mentioned) >= 2:
                for i in range(len(mentioned)):
                    for j in range(i + 1, len(mentioned)):
                        src, tgt = mentioned[i], mentioned[j]
                        # Avoid duplicate edges
                        if not any(e["source"] == src and e["target"] == tgt for e in edges):
                            edges.append({
                                "source": src,
                                "target": tgt,
                                "label": "关联",
                            })

    return {"nodes": nodes, "edges": edges}
