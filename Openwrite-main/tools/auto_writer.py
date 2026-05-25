"""自动写作模块 — 循环执行 write→review→revise 直到完本。"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

import yaml

logger = logging.getLogger(__name__)


# ── 数据结构 ──────────────────────────────────────────────────


@dataclass
class AutoWriterConfig:
    max_retries: int = 3          # 每章最大修订次数
    score_threshold: int = 70     # 及格分数（0-100）
    target_words: int = 3000      # 每章目标字数
    guidance: str = ""            # 全局写作指导
    start_chapter: str = ""       # 起始章节（空=从下一章开始）
    max_chapters: int = 0         # 最多写几章（0=写到大纲结束）


@dataclass
class ChapterResult:
    chapter_id: str
    score: float = 0.0
    passed: bool = False
    retries: int = 0
    word_count: int = 0
    error: str = ""


@dataclass
class AutoWriteResult:
    chapters: list[ChapterResult] = field(default_factory=list)
    total_written: int = 0
    total_passed: int = 0
    stopped_reason: str = ""  # "completed" | "cancelled" | "error"


# ── 核心类 ────────────────────────────────────────────────────


class AutoWriter:
    """自动写作引擎：遍历大纲章节，写→审→改循环。"""

    def __init__(
        self,
        project_root: Path,
        config: AutoWriterConfig,
        on_progress: Optional[Callable[[dict], None]] = None,
    ):
        self.project_root = project_root
        self.config = config
        self.on_progress = on_progress or (lambda _: None)
        self.cancelled = False
        self.paused = False

    # ── 公开方法 ──

    async def run(self) -> AutoWriteResult:
        """主循环：遍历大纲中的待写章节，逐一写作。"""
        from tools.cli import _load_config, _list_chapter_ids, _get_next_chapter

        cfg = _load_config(self.project_root)
        if not cfg:
            return AutoWriteResult(stopped_reason="error")

        novel_id = cfg.get("novel_id", "")
        planned = self._load_planned_chapters(novel_id)
        written = set(_list_chapter_ids(self.project_root, novel_id))

        # 确定待写章节列表
        if self.config.start_chapter:
            start = self.config.start_chapter
        else:
            start = _get_next_chapter(self.project_root, novel_id)

        todo = [ch for ch in planned if _ch_num(ch) >= _ch_num(start) and ch not in written]
        if not todo:
            return AutoWriteResult(stopped_reason="completed")

        if self.config.max_chapters > 0:
            todo = todo[: self.config.max_chapters]

        self._emit("started", total=len(todo), chapters=todo)

        results: list[ChapterResult] = []
        for i, chapter_id in enumerate(todo):
            if self.cancelled:
                self._emit("cancelled", completed=len(results))
                break

            while self.paused:
                await asyncio.sleep(0.5)
                if self.cancelled:
                    break

            self._emit("chapter_start", chapter=chapter_id, index=i, total=len(todo))
            cr = await self._write_and_review(chapter_id, novel_id)
            results.append(cr)

            self._emit("chapter_done", chapter=chapter_id, score=cr.score,
                        passed=cr.passed, retries=cr.retries, word_count=cr.word_count,
                        error=cr.error, completed=len(results), total=len(todo))

        total_passed = sum(1 for r in results if r.passed)
        reason = "cancelled" if self.cancelled else "completed"
        return AutoWriteResult(
            chapters=results,
            total_written=len(results),
            total_passed=total_passed,
            stopped_reason=reason,
        )

    def cancel(self):
        self.cancelled = True

    def pause(self):
        self.paused = True

    def resume(self):
        self.paused = False

    # ── 内部方法 ──

    async def _write_and_review(self, chapter_id: str, novel_id: str) -> ChapterResult:
        """单章：写作→审查→（可选修订循环）。"""
        guidance = self.config.guidance
        max_retries = self.config.max_retries

        for attempt in range(max_retries + 1):
            if self.cancelled:
                return ChapterResult(chapter_id=chapter_id, error="cancelled")

            # 写作
            self._emit("phase", chapter=chapter_id, phase="writing", attempt=attempt)
            write_result = await self._exec_write(chapter_id, guidance)
            if not write_result.get("ok"):
                return ChapterResult(
                    chapter_id=chapter_id,
                    error=write_result.get("error", "write_failed"),
                )

            word_count = write_result.get("word_count", 0)

            # 审查
            self._emit("phase", chapter=chapter_id, phase="reviewing", attempt=attempt)
            review_result = await self._exec_review(chapter_id)
            if not review_result.get("ok"):
                # 审查失败不算章节失败，跳过审查继续
                return ChapterResult(
                    chapter_id=chapter_id,
                    word_count=word_count,
                    score=0,
                    passed=True,  # 审查失败默认通过
                    retries=attempt,
                    error="review_error: " + review_result.get("error", ""),
                )

            score = review_result.get("score", 0)
            passed = review_result.get("passed", False)
            issues_count = review_result.get("issues", 0)
            summary = review_result.get("summary", "")

            if passed or score >= self.config.score_threshold:
                return ChapterResult(
                    chapter_id=chapter_id,
                    score=score,
                    passed=True,
                    retries=attempt,
                    word_count=word_count,
                )

            # 需要修订
            if attempt < max_retries:
                self._emit("chapter_revising", chapter=chapter_id,
                            attempt=attempt + 1, max=max_retries,
                            score=score, issues=issues_count, summary=summary)
                guidance = (
                    f"上一稿审查未通过（得分{score}，{issues_count}个问题）。"
                    f"问题摘要：{summary}。"
                    f"请针对这些问题修正后重写本章，保持情节连贯。"
                )
            else:
                # 用完重试次数
                return ChapterResult(
                    chapter_id=chapter_id,
                    score=score,
                    passed=False,
                    retries=attempt,
                    word_count=word_count,
                )

        return ChapterResult(chapter_id=chapter_id, error="unreachable")

    async def _exec_write(self, chapter_id: str, guidance: str) -> dict:
        """在线程池中执行 write_chapter。"""
        from tools.cli import _exec_write_chapter

        loop = asyncio.get_event_loop()
        args = {
            "chapter_id": chapter_id,
            "guidance": guidance,
            "target_words": self.config.target_words,
        }
        return await loop.run_in_executor(
            None, _exec_write_chapter, self.project_root, args
        )

    async def _exec_review(self, chapter_id: str) -> dict:
        """在线程池中执行 review_chapter。"""
        from tools.cli import _exec_review_chapter

        loop = asyncio.get_event_loop()
        args = {"chapter_id": chapter_id}
        return await loop.run_in_executor(
            None, _exec_review_chapter, self.project_root, args
        )

    def _load_planned_chapters(self, novel_id: str) -> list[str]:
        """从 hierarchy.yaml 加载大纲中的所有章节 ID。"""
        hierarchy_path = (
            self.project_root / "data" / "novels" / novel_id / "data" / "hierarchy.yaml"
        )
        if not hierarchy_path.exists():
            return []

        with open(hierarchy_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        chapters: list[str] = []
        for arc in data.get("arcs", []):
            chapters.extend(arc.get("chapters", []))
        return sorted(chapters, key=_ch_num)

    def _emit(self, event_type: str, **kwargs):
        """发送进度事件。"""
        try:
            self.on_progress({"type": event_type, **kwargs})
        except Exception:
            logger.exception("on_progress callback failed")


def _ch_num(chapter_id: str) -> int:
    """从 chapter_id 提取数字编号。"""
    import re
    m = re.search(r"(\d+)", chapter_id)
    return int(m.group(1)) if m else 0
