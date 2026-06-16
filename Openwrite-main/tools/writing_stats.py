"""写作统计工具 — 分析章节字数、写作速度、趋势。"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


def _list_chapter_files(project_root: Path, novel_id: str) -> list[Path]:
    """列出所有章节文件路径。"""
    manuscript_dir = project_root / "data" / "novels" / novel_id / "data" / "manuscript"
    if not manuscript_dir.exists():
        return []
    pattern = re.compile(r"^ch_\d+\.md$")
    return sorted(
        [p for p in manuscript_dir.rglob("*.md") if p.is_file() and pattern.fullmatch(p.name)],
        key=lambda p: p.name,
    )


def _count_chinese_words(text: str) -> int:
    """计算中文字数（中文字符 + 英文单词数）。"""
    chinese = len(re.findall(r"[一-鿿]", text))
    english = len(re.findall(r"[a-zA-Z]+", text))
    return chinese + english


def get_writing_stats(project_root: Path, novel_id: str) -> dict[str, Any]:
    """获取写作统计数据。"""
    files = _list_chapter_files(project_root, novel_id)

    if not files:
        return {
            "total_chapters": 0,
            "total_chars": 0,
            "total_words": 0,
            "avg_chapter_words": 0,
            "chapters": [],
            "daily_stats": [],
            "velocity": [],
        }

    chapters = []
    total_chars = 0
    total_words = 0
    daily_map: dict[str, dict[str, Any]] = {}

    for f in files:
        content = f.read_text(encoding="utf-8")
        chars = len(content)
        words = _count_chinese_words(content)

        # Extract title
        title = f.stem
        for line in content.split("\n"):
            if line.startswith("# "):
                title = line[2:].strip()
                break

        # File modification time
        mtime = datetime.fromtimestamp(os.path.getmtime(f))
        date_str = mtime.strftime("%Y-%m-%d")

        chapters.append({
            "chapter_id": f.stem,
            "title": title,
            "chars": chars,
            "words": words,
            "modified": mtime.isoformat(),
        })

        total_chars += chars
        total_words += words

        # Daily aggregation
        if date_str not in daily_map:
            daily_map[date_str] = {"date": date_str, "chapters": 0, "chars": 0, "words": 0}
        daily_map[date_str]["chapters"] += 1
        daily_map[date_str]["chars"] += chars
        daily_map[date_str]["words"] += words

    # Sort daily stats
    daily_stats = sorted(daily_map.values(), key=lambda x: x["date"])

    # Calculate velocity (words per day over last 7 days)
    velocity = []
    if daily_stats:
        today = datetime.now().date()
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            d_str = d.isoformat()
            day_data = daily_map.get(d_str, {"date": d_str, "chapters": 0, "chars": 0, "words": 0})
            velocity.append(day_data)

    # Streak calculation
    streak = 0
    if daily_stats:
        today = datetime.now().date()
        for i in range(365):
            d = today - timedelta(days=i)
            if d.isoformat() in daily_map:
                streak += 1
            else:
                break

    return {
        "total_chapters": len(chapters),
        "total_chars": total_chars,
        "total_words": total_words,
        "avg_chapter_words": total_words // len(chapters) if chapters else 0,
        "chapters": chapters,
        "daily_stats": daily_stats,
        "velocity": velocity,
        "streak": streak,
        "longest_chapter": max(chapters, key=lambda c: c["words"]) if chapters else None,
        "shortest_chapter": min(chapters, key=lambda c: c["words"]) if chapters else None,
    }
