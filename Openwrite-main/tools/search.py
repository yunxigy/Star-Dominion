"""全局搜索工具 — 跨章节、角色、大纲搜索。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


def global_search(
    project_root: Path,
    novel_id: str,
    query: str,
    *,
    search_chapters: bool = True,
    search_characters: bool = True,
    search_outline: bool = True,
    search_truth: bool = True,
    max_results: int = 50,
) -> dict[str, Any]:
    """全局搜索小说内容。"""
    if not query.strip():
        return {"results": [], "total": 0, "query": query}

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        return {"results": [], "total": 0, "query": query}

    results: list[dict[str, Any]] = []
    query_lower = query.lower()
    pattern = re.compile(re.escape(query), re.IGNORECASE)

    # Search chapters
    if search_chapters:
        manuscript_dir = novel_dir / "data" / "manuscript"
        if manuscript_dir.exists():
            for f in sorted(manuscript_dir.rglob("*.md")):
                if not f.is_file() or not re.match(r"^ch_\d+\.md$", f.stem):
                    continue
                content = f.read_text(encoding="utf-8")
                title = f.stem
                for line in content.split("\n"):
                    if line.startswith("# "):
                        title = line[2:].strip()
                        break

                matches = _find_matches(content, pattern, context_len=60)
                for match in matches[:3]:  # Max 3 matches per file
                    results.append({
                        "type": "chapter",
                        "id": f.stem,
                        "title": title,
                        "file": str(f.relative_to(project_root)),
                        "match_text": match["text"],
                        "line_number": match["line"],
                        "context": match["context"],
                    })
                if len(results) >= max_results:
                    break

    # Search characters
    if search_characters:
        chars_dir = novel_dir / "src" / "characters"
        if chars_dir.exists():
            for f in sorted(chars_dir.glob("*.md")):
                content = f.read_text(encoding="utf-8")
                name = f.stem
                # Parse frontmatter for name
                if content.startswith("---"):
                    parts = content.split("---", 2)
                    if len(parts) >= 3:
                        import yaml
                        try:
                            meta = yaml.safe_load(parts[1]) or {}
                            name = meta.get("name", name)
                        except Exception:
                            pass

                if query_lower in name.lower() or query_lower in content.lower():
                    matches = _find_matches(content, pattern, context_len=60)
                    for match in matches[:2]:
                        results.append({
                            "type": "character",
                            "id": f.stem,
                            "title": name,
                            "file": str(f.relative_to(project_root)),
                            "match_text": match["text"],
                            "line_number": match["line"],
                            "context": match["context"],
                        })
                if len(results) >= max_results:
                    break

    # Search outline
    if search_outline:
        outline_path = novel_dir / "src" / "outline.md"
        if outline_path.exists():
            content = outline_path.read_text(encoding="utf-8")
            if query_lower in content.lower():
                matches = _find_matches(content, pattern, context_len=60)
                for match in matches[:3]:
                    results.append({
                        "type": "outline",
                        "id": "outline",
                        "title": "大纲",
                        "file": str(outline_path.relative_to(project_root)),
                        "match_text": match["text"],
                        "line_number": match["line"],
                        "context": match["context"],
                    })

    # Search truth files
    if search_truth:
        truth_dir = novel_dir / "data"
        if truth_dir.exists():
            for name in ["current_state.md", "ledger.md", "relationships.md"]:
                f = truth_dir / name
                if not f.exists():
                    continue
                content = f.read_text(encoding="utf-8")
                if query_lower in content.lower():
                    matches = _find_matches(content, pattern, context_len=60)
                    for match in matches[:2]:
                        results.append({
                            "type": "truth",
                            "id": name.replace(".md", ""),
                            "title": name.replace(".md", "").replace("_", " ").title(),
                            "file": str(f.relative_to(project_root)),
                            "match_text": match["text"],
                            "line_number": match["line"],
                            "context": match["context"],
                        })

    return {
        "results": results[:max_results],
        "total": len(results),
        "query": query,
    }


def _find_matches(
    content: str,
    pattern: re.Pattern,
    context_len: int = 60,
) -> list[dict[str, Any]]:
    """在文本中查找匹配项，返回匹配上下文。"""
    matches = []
    lines = content.split("\n")
    for i, line in enumerate(lines):
        for m in pattern.finditer(line):
            start = max(0, m.start() - context_len)
            end = min(len(line), m.end() + context_len)
            context = line[start:end]
            if start > 0:
                context = "..." + context
            if end < len(line):
                context = context + "..."
            matches.append({
                "text": m.group(),
                "line": i + 1,
                "context": context,
            })
    return matches
