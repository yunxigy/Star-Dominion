"""章节版本历史工具 — 保存快照、查看历史、对比差异。"""

from __future__ import annotations

import difflib
import os
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any


def _history_dir(project_root: Path, novel_id: str) -> Path:
    """获取版本历史目录。"""
    return project_root / "data" / "novels" / novel_id / "data" / "history"


def save_snapshot(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
    content: str,
    reason: str = "manual",
) -> dict[str, Any]:
    """保存章节快照（写入前调用）。

    Args:
        project_root: 项目根目录
        novel_id: 小说 ID
        chapter_id: 章节 ID
        content: 当前内容
        reason: 保存原因（manual/auto/ai_write/review）

    Returns:
        {"version": int, "timestamp": str, "path": str}
    """
    hist_dir = _history_dir(project_root, novel_id) / chapter_id
    hist_dir.mkdir(parents=True, exist_ok=True)

    # Find next version number
    existing = sorted(hist_dir.glob("v_*.md"))
    version = len(existing) + 1

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"v_{version:04d}_{timestamp}.md"
    filepath = hist_dir / filename

    # Write snapshot with metadata header
    header = f"""---
version: {version}
chapter_id: {chapter_id}
timestamp: {timestamp}
reason: {reason}
char_count: {len(content)}
---

"""
    filepath.write_text(header + content, encoding="utf-8")

    return {
        "version": version,
        "timestamp": timestamp,
        "reason": reason,
        "path": str(filepath),
    }


def list_versions(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
) -> list[dict[str, Any]]:
    """列出章节的所有版本。"""
    hist_dir = _history_dir(project_root, novel_id) / chapter_id
    if not hist_dir.exists():
        return []

    versions = []
    for f in sorted(hist_dir.glob("v_*.md")):
        content = f.read_text(encoding="utf-8")
        meta = _parse_snapshot_meta(content)
        versions.append({
            "filename": f.name,
            "version": meta.get("version", 0),
            "timestamp": meta.get("timestamp", ""),
            "reason": meta.get("reason", ""),
            "char_count": meta.get("char_count", 0),
            "path": str(f),
        })

    return sorted(versions, key=lambda v: v["version"], reverse=True)


def get_version_content(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
    version: int,
) -> str | None:
    """获取指定版本的内容。"""
    hist_dir = _history_dir(project_root, novel_id) / chapter_id
    if not hist_dir.exists():
        return None

    for f in hist_dir.glob(f"v_{version:04d}_*.md"):
        content = f.read_text(encoding="utf-8")
        # Strip metadata header
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                return parts[2].strip()
        return content

    return None


def diff_versions(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
    version_a: int,
    version_b: int,
) -> dict[str, Any]:
    """对比两个版本的差异。

    Returns:
        {
            "version_a": int,
            "version_b": int,
            "diff_html": str,      # HTML 格式的 diff
            "diff_plain": str,     # 纯文本格式的 diff
            "stats": {
                "added_lines": int,
                "removed_lines": int,
                "changed_lines": int,
            }
        }
    """
    content_a = get_version_content(project_root, novel_id, chapter_id, version_a) or ""
    content_b = get_version_content(project_root, novel_id, chapter_id, version_b) or ""

    lines_a = content_a.splitlines(keepends=True)
    lines_b = content_b.splitlines(keepends=True)

    # Generate unified diff
    diff_lines = list(difflib.unified_diff(
        lines_a, lines_b,
        fromfile=f"v{version_a}",
        tofile=f"v{version_b}",
        lineterm="",
    ))

    # Generate HTML diff
    differ = HtmlDiffer()
    diff_html = differ.make_table(lines_a, lines_b, version_a, version_b)

    # Stats
    added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))

    return {
        "version_a": version_a,
        "version_b": version_b,
        "diff_html": diff_html,
        "diff_plain": "".join(diff_lines),
        "stats": {
            "added_lines": added,
            "removed_lines": removed,
            "changed_lines": max(added, removed),
        },
    }


def diff_with_current(
    project_root: Path,
    novel_id: str,
    chapter_id: str,
    version: int,
) -> dict[str, Any]:
    """对比指定版本与当前章节内容的差异。"""
    # Get current chapter content
    manuscript_dir = project_root / "data" / "novels" / novel_id / "data" / "manuscript"
    current_content = ""
    if manuscript_dir.exists():
        for f in manuscript_dir.rglob(f"**/{chapter_id}.md"):
            if f.is_file() and f.stem == chapter_id:
                current_content = f.read_text(encoding="utf-8")
                # Strip title
                lines = current_content.split("\n")
                body_lines = []
                for line in lines:
                    if line.startswith("# ") and not body_lines:
                        continue
                    body_lines.append(line)
                current_content = "\n".join(body_lines).strip()
                break

    old_content = get_version_content(project_root, novel_id, chapter_id, version) or ""

    lines_old = old_content.splitlines(keepends=True)
    lines_new = current_content.splitlines(keepends=True)

    diff_lines = list(difflib.unified_diff(
        lines_old, lines_new,
        fromfile=f"v{version}",
        tofile="current",
        lineterm="",
    ))

    differ = HtmlDiffer()
    diff_html = differ.make_table(lines_old, lines_new, version, 0)

    added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))

    return {
        "version_a": version,
        "version_b": 0,  # 0 = current
        "diff_html": diff_html,
        "diff_plain": "".join(diff_lines),
        "stats": {
            "added_lines": added,
            "removed_lines": removed,
            "changed_lines": max(added, removed),
        },
    }


def _parse_snapshot_meta(content: str) -> dict[str, Any]:
    """解析快照文件的元数据。"""
    meta: dict[str, Any] = {}
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                import yaml
                meta = yaml.safe_load(parts[1]) or {}
            except Exception:
                pass
    return meta


class HtmlDiffer:
    """生成 HTML 格式的行级 diff。"""

    def make_table(
        self,
        lines_a: list[str],
        lines_b: list[str],
        version_a: int,
        version_b: int,
    ) -> str:
        """生成 HTML diff 表格。"""
        sm = difflib.SequenceMatcher(None, lines_a, lines_b)
        rows = []

        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == "equal":
                for k in range(i2 - i1):
                    line = lines_a[i1 + k].rstrip()
                    rows.append(f'<tr class="diff-eq"><td class="ln">{i1+k+1}</td><td class="ln">{j1+k+1}</td><td>{self._escape(line)}</td></tr>')
            elif op == "replace":
                max_len = max(i2 - i1, j2 - j1)
                for k in range(max_len):
                    old = lines_a[i1 + k].rstrip() if k < (i2 - i1) else ""
                    new = lines_b[j1 + k].rstrip() if k < (j2 - j1) else ""
                    old_ln = str(i1 + k + 1) if k < (i2 - i1) else ""
                    new_ln = str(j1 + k + 1) if k < (j2 - j1) else ""
                    if old:
                        rows.append(f'<tr class="diff-del"><td class="ln">{old_ln}</td><td class="ln"></td><td>- {self._escape(old)}</td></tr>')
                    if new:
                        rows.append(f'<tr class="diff-add"><td class="ln"></td><td class="ln">{new_ln}</td><td>+ {self._escape(new)}</td></tr>')
            elif op == "insert":
                for k in range(j2 - j1):
                    line = lines_b[j1 + k].rstrip()
                    rows.append(f'<tr class="diff-add"><td class="ln"></td><td class="ln">{j1+k+1}</td><td>+ {self._escape(line)}</td></tr>')
            elif op == "delete":
                for k in range(i2 - i1):
                    line = lines_a[i1 + k].rstrip()
                    rows.append(f'<tr class="diff-del"><td class="ln">{i1+k+1}</td><td class="ln"></td><td>- {self._escape(line)}</td></tr>')

        return f"""<table class="diff-table">
<thead><tr><th>v{version_a}</th><th>v{version_b if version_b else 'current'}</th><th>内容</th></tr></thead>
<tbody>{"".join(rows)}</tbody></table>"""

    @staticmethod
    def _escape(text: str) -> str:
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
