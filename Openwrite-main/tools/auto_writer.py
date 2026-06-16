"""自动写作模块 — 循环执行 write→review→revise 直到完本。"""

from __future__ import annotations

import asyncio
import logging
import re
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
    auto_outline: bool = True     # 大纲用完时自动生成新大纲
    outline_batch: int = 5        # 每次自动生成的章节数
    continue_on_review_error: bool = False  # 审查API失败时是否继续（默认不继续）


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
        novel_id: str = "",
    ):
        self.project_root = project_root
        self.config = config
        self.on_progress = on_progress or (lambda _: None)
        self.cancelled = False
        self.paused = False
        self._novel_id = novel_id

    # ── 公开方法 ──

    async def run(self) -> AutoWriteResult:
        """主循环：遍历大纲中的待写章节，逐一写作。"""
        from tools.cli import _load_config, _list_chapter_ids, _get_next_chapter

        cfg = _load_config(self.project_root)
        if not cfg:
            return AutoWriteResult(stopped_reason="error")

        novel_id = self._novel_id or cfg.get("novel_id", "")
        total_generated = 0  # 自动生成的大纲批次计数

        self._emit("started", total=0, chapters=[])

        results: list[ChapterResult] = []
        chapter_index = 0

        while not self.cancelled:
            # 加载当前大纲和已写章节
            planned = self._load_planned_chapters(novel_id)
            written = set(_list_chapter_ids(self.project_root, novel_id))

            # 确定待写章节列表
            if self.config.start_chapter and chapter_index == 0:
                start = self.config.start_chapter
            else:
                start = _get_next_chapter(self.project_root, novel_id)

            todo = [ch for ch in planned if _ch_num(ch) >= _ch_num(start) and ch not in written]

            if self.config.max_chapters > 0:
                remaining = self.config.max_chapters - len(results)
                todo = todo[:remaining]

            # 大纲用完且开启自动生成
            if not todo and self.config.auto_outline:
                self._emit("outline_generating", batch=total_generated + 1)
                new_chapters = await self._generate_outline(novel_id)
                if not new_chapters:
                    self._emit("outline_failed", message="无法生成新大纲")
                    break
                total_generated += 1
                self._emit("outline_generated", chapters=new_chapters, batch=total_generated)
                continue  # 重新加载大纲

            if not todo:
                break

            for chapter_id in todo:
                if self.cancelled:
                    self._emit("cancelled", completed=len(results))
                    break

                while self.paused:
                    await asyncio.sleep(0.5)
                    if self.cancelled:
                        break

                self._emit("chapter_start", chapter=chapter_id, index=chapter_index, total=len(todo) + len(results))
                cr = await self._write_and_review(chapter_id, novel_id)
                results.append(cr)
                chapter_index += 1

                self._emit("chapter_done", chapter=chapter_id, score=cr.score,
                            passed=cr.passed, retries=cr.retries, word_count=cr.word_count,
                            error=cr.error, completed=len(results), total=len(todo) + len(results))

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
                # 审查API调用失败
                if self.config.continue_on_review_error:
                    return ChapterResult(
                        chapter_id=chapter_id,
                        word_count=word_count,
                        score=0,
                        passed=True,
                        retries=attempt,
                        error="review_error(continued): " + review_result.get("error", ""),
                    )
                return ChapterResult(
                    chapter_id=chapter_id,
                    word_count=word_count,
                    score=0,
                    passed=False,
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

    async def _generate_outline(self, novel_id: str) -> list[str]:
        """使用 AI 自动生成新大纲章节，返回新章节 ID 列表。"""
        from tools.llm import LLMClient, LLMConfig
        from tools.cli import _load_config, _list_chapter_ids

        try:
            llm_config = LLMConfig.from_env()
            client = LLMClient(llm_config)
        except Exception as e:
            logger.error(f"初始化 LLM 客户端失败: {e}")
            return []

        # 读取已有大纲和最近章节
        hierarchy_path = self.project_root / "data" / "novels" / novel_id / "data" / "hierarchy.yaml"
        with open(hierarchy_path, "r", encoding="utf-8") as f:
            hierarchy_data = yaml.safe_load(f) or {}

        # 读取最近 3 章内容作为上下文
        written_ids = _list_chapter_ids(self.project_root, novel_id)
        recent_chapters = []
        from tools.cli import _load_chapter
        for ch_id in written_ids[-3:]:
            content = _load_chapter(self.project_root, novel_id, ch_id)
            if content:
                recent_chapters.append(f"## {ch_id}\n{content[:800]}")

        # 构建提示词
        existing_arcs = hierarchy_data.get("arcs", [])
        arc_summaries = []
        for arc in existing_arcs:
            arc_summaries.append(f"- {arc.get('title', '')} (id: {arc.get('id', '')})")

        batch_size = self.config.outline_batch
        prompt = f"""你是一个网文大纲规划专家。请根据以下信息，为小说续写 {batch_size} 个新章节的大纲。

## 已有篇章结构
{chr(10).join(arc_summaries)}

## 最近章节内容（用于保持情节连贯）
{chr(10).join(recent_chapters) if recent_chapters else "（暂无已写章节）"}

## 全局写作指导
{self.config.guidance if self.config.guidance else "（无）"}

## 要求
1. 每个章节需要一个简洁标题
2. 情节要连贯推进，有起承转合
3. 需要有冲突、悬念或转折

请以 YAML 格式输出，格式如下：
```yaml
sections:
- id: sec_NNN
  title: 第N章 章节标题
  summary: 一句话概括本章内容
```

只输出 YAML，不要其他内容。"""

        try:
            from tools.llm.client import Message as LLMMessage
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: client.chat(
                    messages=[LLMMessage(role="user", content=prompt)],
                    temperature=0.8,
                    max_tokens=2000,
                ),
            )
            content = response.get("content", "")

            # 提取 YAML
            yaml_match = re.search(r"```yaml\s*\n(.*?)\n```", content, re.DOTALL)
            if yaml_match:
                yaml_content = yaml_match.group(1)
            else:
                yaml_content = content

            new_data = yaml.safe_load(yaml_content) or {}
            new_sections = new_data.get("sections", [])

            if not new_sections:
                return []

            # 生成对应的章节 ID
            next_num = len(written_ids) + 1
            new_chapter_ids = []
            for i, sec in enumerate(new_sections):
                ch_id = f"ch_{next_num + i:03d}"
                sec_id = f"sec_{next_num + i:03d}"
                sec["id"] = sec_id
                new_chapter_ids.append(ch_id)

            # 更新 hierarchy.yaml
            self._append_to_hierarchy(novel_id, new_sections, new_chapter_ids)

            return new_chapter_ids

        except Exception as e:
            logger.error(f"自动生成大纲失败: {e}")
            return []

    def _append_to_hierarchy(self, novel_id: str, new_sections: list[dict], new_chapter_ids: list[str]):
        """将新生成的大纲追加到 hierarchy.yaml。"""
        hierarchy_path = self.project_root / "data" / "novels" / novel_id / "data" / "hierarchy.yaml"

        with open(hierarchy_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        # 找到最后一个 arc 或创建新的
        arcs = data.get("arcs", [])
        if arcs:
            last_arc = arcs[-1]
        else:
            last_arc = {"id": "arc_001", "title": "自动生成", "sections": [], "chapters": []}
            arcs.append(last_arc)

        # 添加新 sections 到最后一个 arc
        for sec in new_sections:
            sec_id = sec.get("id", "")
            if sec_id:
                last_arc.setdefault("sections", []).append(sec_id)

        # 添加新 sections 到全局 sections 列表
        data.setdefault("sections", []).extend(new_sections)

        # 保存
        with open(hierarchy_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    def _load_planned_chapters(self, novel_id: str) -> list[str]:
        """从 hierarchy.yaml 加载大纲中的所有章节 ID。"""
        hierarchy_path = (
            self.project_root / "data" / "novels" / novel_id / "data" / "hierarchy.yaml"
        )
        if not hierarchy_path.exists():
            return []

        with open(hierarchy_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        # 建立 section_id → chapter_id 的映射表
        sections = data.get("sections", [])
        sec_to_ch: dict[str, str] = {}
        for sec in sections:
            sid = sec.get("id", "")
            if sid.startswith("sec_"):
                ch_id = "ch_" + sid[4:]  # sec_001 → ch_001
                sec_to_ch[sid] = ch_id

        chapters: list[str] = []
        for arc in data.get("arcs", []):
            # 优先读 chapters，若为空则从 sections 推导
            arc_chapters = arc.get("chapters", [])
            if arc_chapters:
                chapters.extend(arc_chapters)
            else:
                for sid in arc.get("sections", []):
                    if sid in sec_to_ch:
                        chapters.append(sec_to_ch[sid])

        return sorted(set(chapters), key=_ch_num)

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
