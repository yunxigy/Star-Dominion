"""小说立项与滚动大纲草案存储。

这个模块负责 Goethe 侧的 planning 真源与运行态草案：
- `data/planning/*` 记录会话中间产物和未确认内容
- `src/story/*` 与 `src/outline.md` 记录当前 canonical 资产

这里的核心约束不是“保存更多文件”，而是维持草案、确认版和 handoff 之间的镜像关系，
让 Goethe/Dante/CLI 看到的是同一套资产，而不是并行维护多份内容。
"""

from __future__ import annotations

import difflib
import hashlib
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import yaml

from .frontmatter import compose_toml_document, parse_toml_front_matter, strip_front_matter_padding
from .text_range import (
    normalized_text_spans,
    select_folded_range_anchors,
    select_normalized_text_span,
)

MAX_OUTLINE_EDIT_BATCH_EDITS = 8
MAX_OUTLINE_EDIT_BATCH_CHARS = 12_000
LONG_OLD_TEXT_CHARS = 240


class StoryPlanningStore:
    """管理立项聊天、基础设定和滚动大纲的草案文件。

    它本身不决定“该写什么”，只负责把 planning 流中的文本资产放到正确位置：
    - ideation / summary 作为会话沉淀
    - background / foundation / outline 作为可晋升的故事资产
    - handoff 文件作为 Goethe -> Dante 的交接记录
    """

    def __init__(self, project_root: Path, novel_id: str):
        self.project_root = Path(project_root).resolve()
        self.novel_id = novel_id
        self.novel_root = self.project_root / "data" / "novels" / novel_id
        self.runtime_planning_dir = self.novel_root / "data" / "planning"
        self.workflow_dir = self.novel_root / "data" / "workflows"
        self.story_src_dir = self.novel_root / "src" / "story"
        self.outline_src_path = self.novel_root / "src" / "outline.md"

        self.ideation_path = self.runtime_planning_dir / "ideation.md"
        self.ideation_summary_path = self.runtime_planning_dir / "ideation_summary.md"
        self.background_draft_path = self.runtime_planning_dir / "background_draft.md"
        self.foundation_draft_path = self.runtime_planning_dir / "foundation_draft.md"
        self.volume_outline_draft_path = self.runtime_planning_dir / "volume_outline_draft.md"
        self.current_state_draft_path = self.runtime_planning_dir / "current_state_draft.md"
        self.foreshadowing_draft_path = self.runtime_planning_dir / "foreshadowing_draft.yaml"
        self.outline_draft_path = self.runtime_planning_dir / "outline_draft.md"
        self.outline_edit_state_path = self.runtime_planning_dir / "outline_edit.yaml"
        self.goethe_handoff_md_path = self.workflow_dir / "goethe_handoff.md"
        self.goethe_handoff_yaml_path = self.workflow_dir / "goethe_handoff.yaml"

    def append_ideation(self, text: str) -> None:
        """追加一段原始灵感记录，不做结构化改写。"""
        self.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
        previous = (
            self.ideation_path.read_text(encoding="utf-8") if self.ideation_path.exists() else ""
        )
        content = previous.rstrip("\n")
        if content:
            content += "\n"
        content += text
        self.ideation_path.write_text(content.rstrip("\n") + "\n", encoding="utf-8")

    def save_ideation_summary(self, text: str) -> None:
        """保存 ideation 的结构化汇总，并记录与原始 ideation 的对应哈希。"""
        self.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
        ideation = (
            self.ideation_path.read_text(encoding="utf-8") if self.ideation_path.exists() else ""
        )
        source_hash = self._hash_text(ideation)
        meta, body = parse_toml_front_matter(text)
        normalized_body = strip_front_matter_padding(body if meta else text).strip()
        normalized_meta = dict(meta) if meta else {}
        # summary 文档既给人读，也给 agent 做“这份总结是否已过期”的快速判断。
        normalized_meta.setdefault("id", "ideation_summary")
        normalized_meta.setdefault("type", "planning_summary")
        normalized_meta.setdefault("source", "ideation")
        normalized_meta["source_hash"] = source_hash
        normalized_meta.setdefault("summary", self._extract_story_summary(normalized_body))
        normalized_meta.setdefault(
            "detail_refs",
            ["核心方向", "稳定共识", "待确认点", "开放问题", "下一步"],
        )
        self.ideation_summary_path.write_text(
            compose_toml_document(normalized_meta, normalized_body),
            encoding="utf-8",
        )

    def ideation_summary_is_current(self) -> bool:
        """判断 ideation summary 是否仍然覆盖了最新的 ideation 原文。"""
        if not self.ideation_path.exists():
            return not self.ideation_summary_path.exists()
        if not self.ideation_summary_path.exists():
            return False
        meta, body = parse_toml_front_matter(self.ideation_summary_path.read_text(encoding="utf-8"))
        if not body.strip():
            return False
        current_hash = self._hash_text(self.ideation_path.read_text(encoding="utf-8"))
        return str(meta.get("source_hash", "")).strip() == current_hash

    def read_ideation_summary(self, max_chars: int = 0) -> str:
        if not self.ideation_summary_path.exists():
            return ""
        text = self.ideation_summary_path.read_text(encoding="utf-8")
        meta, body = parse_toml_front_matter(text)
        normalized_body = strip_front_matter_padding(body if meta else text)
        parts = []
        summary = str(meta.get("summary", "")).strip()
        detail_refs = meta.get("detail_refs", [])
        if summary:
            parts.append(f"摘要：{summary}")
        if isinstance(detail_refs, list) and detail_refs:
            parts.append("细节索引：" + "、".join(str(item) for item in detail_refs))
        if normalized_body:
            parts.append(normalized_body)
        rendered = "\n".join(parts).strip()
        if max_chars and len(rendered) > max_chars:
            return rendered[:max_chars]
        return rendered

    def seed_placeholder_foundation_from_ideation_summary(self) -> bool:
        """Persist a confirmed summary when the foundation is still a template."""
        if not self.ideation_summary_is_current():
            return False

        foundation_path = self.story_src_dir / "foundation.md"
        existing = foundation_path.read_text(encoding="utf-8") if foundation_path.exists() else ""
        if self._story_document_has_content(existing):
            return False

        summary_text = self.ideation_summary_path.read_text(encoding="utf-8")
        summary_meta, summary_body = parse_toml_front_matter(summary_text)
        summary = strip_front_matter_padding(summary_body if summary_meta else summary_text).strip()
        if not summary:
            return False

        content = self._normalize_story_document(
            "foundation",
            "# 基础设定\n\n## 已确认想法汇总\n\n" + summary,
        )
        self.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
        self.story_src_dir.mkdir(parents=True, exist_ok=True)
        self._atomic_write_text(self.foundation_draft_path, content)
        self._atomic_write_text(foundation_path, content)
        return True

    def save_foundation_draft(
        self,
        background: str,
        foundation: str,
        *,
        volume_outline: str = "",
        current_state: str = "",
        foreshadowing: str | dict[str, Any] | None = None,
    ) -> None:
        """保存基础设定草案；确认前不修改 canonical ``src/story/*``。"""
        graph = (
            self._parse_foreshadowing_graph(foreshadowing)
            if foreshadowing not in (None, "")
            else None
        )
        self.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
        background_content = self._normalize_story_document("background", background)
        foundation_content = self._normalize_story_document("foundation", foundation)
        self._atomic_write_text(self.background_draft_path, background_content)
        self._atomic_write_text(self.foundation_draft_path, foundation_content)
        if str(volume_outline or "").strip():
            self._atomic_write_text(
                self.volume_outline_draft_path,
                str(volume_outline).strip() + "\n",
            )
        if str(current_state or "").strip():
            self._atomic_write_text(
                self.current_state_draft_path,
                str(current_state).strip() + "\n",
            )
        if graph is not None:
            self._atomic_write_text(
                self.foreshadowing_draft_path,
                yaml.safe_dump(
                    graph.model_dump(by_alias=True),
                    allow_unicode=True,
                    sort_keys=False,
                ),
            )
        elif self.foreshadowing_draft_path.exists():
            self.foreshadowing_draft_path.unlink()

    def promote_foundation(self) -> bool:
        """将 background/foundation 的当前版本收口成 draft 与 src 的一致镜像。"""
        self.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
        self.story_src_dir.mkdir(parents=True, exist_ok=True)

        background_src = self.story_src_dir / "background.md"
        foundation_src = self.story_src_dir / "foundation.md"

        # 在写任何 canonical 文件前先验证全部结构化草案。
        foreshadowing_graph = None
        if self.foreshadowing_draft_path.exists():
            try:
                foreshadowing_graph = self._parse_foreshadowing_graph(
                    self.foreshadowing_draft_path.read_text(encoding="utf-8")
                )
            except (OSError, ValueError, yaml.YAMLError):
                return False

        # 有草案时以草案为待确认版本，确认后再覆盖 canonical 文档。
        if self.background_draft_path.exists() and self.foundation_draft_path.exists():
            background_content = self._normalize_story_document(
                "background",
                self.background_draft_path.read_text(encoding="utf-8"),
            )
            foundation_content = self._normalize_story_document(
                "foundation",
                self.foundation_draft_path.read_text(encoding="utf-8"),
            )
            self._atomic_write_text(background_src, background_content)
            self._atomic_write_text(foundation_src, foundation_content)
            self._atomic_write_text(self.background_draft_path, background_content)
            self._atomic_write_text(self.foundation_draft_path, foundation_content)
        elif background_src.exists() and foundation_src.exists():
            # 没有待确认草案时，只接受已经存在的 canonical 文档。
            background_content = self._normalize_story_document(
                "background",
                background_src.read_text(encoding="utf-8"),
            )
            foundation_content = self._normalize_story_document(
                "foundation",
                foundation_src.read_text(encoding="utf-8"),
            )
            self._atomic_write_text(background_src, background_content)
            self._atomic_write_text(foundation_src, foundation_content)
        else:
            return False

        if self.current_state_draft_path.exists():
            from .truth_manager import TruthFilesManager

            state_text = self.current_state_draft_path.read_text(encoding="utf-8")
            state_meta, state_body = parse_toml_front_matter(state_text)
            truth = TruthFilesManager(self.project_root, self.novel_id).load_truth_files()
            truth.current_state = strip_front_matter_padding(
                state_body if state_meta else state_text
            ).strip()
            TruthFilesManager(self.project_root, self.novel_id).save_truth_files(truth)

        if foreshadowing_graph is not None:
            dag_path = self.novel_root / "data" / "foreshadowing" / "dag.yaml"
            self._atomic_write_text(
                dag_path,
                yaml.safe_dump(
                    foreshadowing_graph.model_dump(by_alias=True),
                    allow_unicode=True,
                    sort_keys=False,
                ),
            )

        return True

    @staticmethod
    def _parse_foreshadowing_graph(value: str | dict[str, Any]) -> Any:
        from models.foreshadowing import ForeshadowingGraph

        if isinstance(value, dict):
            payload = value
        else:
            text = str(value or "").strip()
            fenced = re.match(r"^```(?:yaml|yml)?\s*\n(?P<body>.*)\n```$", text, re.DOTALL)
            if fenced:
                text = fenced.group("body").strip()
            payload = yaml.safe_load(text) or {}
        if not isinstance(payload, dict):
            raise ValueError("foreshadowing draft must be a YAML object")
        graph = ForeshadowingGraph.model_validate(payload)
        for node_id, node in graph.nodes.items():
            if node_id != node.id:
                raise ValueError(f"foreshadowing node key does not match id: {node_id}")
            if graph.status.get(node_id, node.status) != node.status:
                raise ValueError(f"foreshadowing status mismatch: {node_id}")
        known = set(graph.nodes)
        adjacency = {node_id: [] for node_id in known}
        for edge in graph.edges:
            if edge.from_ not in known:
                raise ValueError(f"foreshadowing edge source does not exist: {edge.from_}")
            if edge.to in known:
                adjacency[edge.from_].append(edge.to)
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node_id: str) -> None:
            if node_id in visiting:
                raise ValueError(f"foreshadowing graph contains a cycle: {node_id}")
            if node_id in visited:
                return
            visiting.add(node_id)
            for target in adjacency[node_id]:
                visit(target)
            visiting.remove(node_id)
            visited.add(node_id)

        for node_id in known:
            visit(node_id)
        return graph

    def save_outline_draft(self, content: str, *, mode: str = "generated") -> None:
        """暂存大纲草稿，不在用户确认前改写 canonical outline。"""
        self.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
        source_exists = self.outline_src_path.exists()
        source = self.read_outline_source()
        self._atomic_write_text(self.outline_draft_path, content)
        self._save_outline_edit_state(
            {
                "base_revision": self._hash_text(source),
                "base_exists": source_exists,
                "draft_revision": self._hash_text(content),
                "mode": mode,
            }
        )

    def read_outline_source(self, max_chars: int = 0) -> str:
        """读取已确认的 canonical 大纲。"""
        if not self.outline_src_path.exists():
            return ""
        text = self.outline_src_path.read_text(encoding="utf-8")
        if max_chars and len(text) > max_chars:
            return text[:max_chars]
        return text

    def outline_source_revision(self) -> str:
        """返回 canonical 大纲的内容 revision，用于防止陈旧补丁覆盖新内容。"""
        return self._hash_text(self.read_outline_source())

    def outline_source_is_placeholder(self) -> bool:
        """判断当前大纲是否仍是 init_project 创建的待填写模板。"""
        source = self.read_outline_source()
        return bool(source) and all(
            marker in source
            for marker in ("核心主题: 待填写", "故事简介: 待填写", "内容焦点: 待填写")
        )

    def read_outline_for_edit(
        self,
        *,
        query: str = "",
        start_line: int = 0,
        end_line: int = 0,
        context_lines: int = 40,
        max_chars: int = 30000,
    ) -> dict[str, Any]:
        """返回适合 ReAct 精确编辑的原文窗口和完整文件 revision。"""
        canonical = self.read_outline_source()
        pending = self._load_outline_edit_state()
        editing_source = canonical
        source_kind = "canonical"
        if pending and self.outline_draft_path.exists():
            pending_base = str(pending.get("base_revision", ""))
            pending_draft = self.outline_draft_path.read_text(encoding="utf-8")
            if pending_base == self._hash_text(canonical) and str(
                pending.get("draft_revision", "")
            ) == self._hash_text(pending_draft):
                editing_source = pending_draft
                source_kind = "pending_draft"

        lines = editing_source.splitlines(keepends=True)
        selected_start = 0
        selected_end = len(lines)

        if start_line > 0:
            selected_start = min(max(start_line - 1, 0), len(lines))
            selected_end = (
                min(max(end_line, start_line), len(lines))
                if end_line > 0
                else min(selected_start + max(context_lines * 2, 1), len(lines))
            )
        elif query:
            needle = query.casefold()
            match_index = next(
                (index for index, line in enumerate(lines) if needle in line.casefold()),
                -1,
            )
            if match_index >= 0:
                selected_start = max(0, match_index - context_lines)
                selected_end = min(len(lines), match_index + context_lines + 1)
            else:
                selected_start = 0
                selected_end = min(len(lines), max(context_lines * 2, 1))
        elif max_chars and len(editing_source) > max_chars:
            selected_end = min(len(lines), 240)

        content = "".join(lines[selected_start:selected_end])
        if max_chars and len(content) > max_chars:
            content = content[:max_chars]

        return {
            "ok": True,
            "path": str(self.outline_src_path),
            "exists": self.outline_src_path.exists(),
            "revision": self._hash_text(editing_source),
            "canonical_revision": self._hash_text(canonical),
            "source_kind": source_kind,
            "content": content,
            "start_line": selected_start + 1 if lines else 0,
            "end_line": selected_end,
            "total_lines": len(lines),
            "truncated": content != editing_source,
            "query_found": not query or query.casefold() in editing_source.casefold(),
            "pending_edit": bool(pending),
            "pending_draft_revision": str(pending.get("draft_revision", "")),
            "pending_batch_count": int(pending.get("batch_count", 0) or 0),
            "pending_final_batch": bool(pending.get("final_batch", False)),
        }

    def stage_outline_edits(
        self,
        *,
        base_revision: str,
        edits: list[dict[str, Any]],
        batch_label: str = "",
        final_batch: bool = True,
    ) -> dict[str, Any]:
        """按 Markdown 章节或精确文本分批暂存修改。"""
        canonical = self.read_outline_source()
        canonical_revision = self._hash_text(canonical)
        if not self.outline_src_path.exists():
            return self._outline_edit_error(
                "missing_outline",
                "当前还没有已确认大纲，请先使用 generate_outline_draft 创建首版草稿。",
                revision=canonical_revision,
            )
        pending = self._load_outline_edit_state()
        working_source = canonical
        source_kind = "canonical"
        expected_revision = canonical_revision
        previous_edit_count = 0
        previous_batch_count = 0
        previous_batches: list[dict[str, Any]] = []
        if pending and self.outline_draft_path.exists():
            if str(pending.get("base_revision", "")) != canonical_revision:
                return self._outline_edit_error(
                    "stale_outline_revision",
                    "已确认大纲在暂存后发生变化，请丢弃或重新生成补丁。",
                    revision=canonical_revision,
                )
            working_source = self.outline_draft_path.read_text(encoding="utf-8")
            source_kind = "pending_draft"
            expected_revision = self._hash_text(working_source)
            if str(pending.get("draft_revision", "")) != expected_revision:
                return self._outline_edit_error(
                    "stale_outline_draft",
                    "待确认草稿已被外部修改，请重新读取后再编辑。",
                    revision=expected_revision,
                )
            try:
                previous_edit_count = int(pending.get("edit_count", 0) or 0)
            except (TypeError, ValueError):
                previous_edit_count = 0
            try:
                previous_batch_count = int(pending.get("batch_count", 0) or 0)
            except (TypeError, ValueError):
                previous_batch_count = 0
            if isinstance(pending.get("batches"), list):
                previous_batches = [
                    dict(item) for item in pending["batches"] if isinstance(item, dict)
                ]
        if not str(base_revision or "").strip():
            return self._outline_edit_error(
                "missing_base_revision",
                "缺少 base_revision，请先调用 read_outline。",
                revision=expected_revision,
            )
        if base_revision != expected_revision:
            return self._outline_edit_error(
                "stale_outline_revision",
                "大纲已被其他操作修改，请重新读取后再生成补丁。",
                revision=expected_revision,
            )
        if not edits:
            return self._outline_edit_error(
                "missing_edits",
                "没有可暂存的大纲修改。",
                revision=expected_revision,
            )
        if len(edits) > MAX_OUTLINE_EDIT_BATCH_EDITS:
            return self._outline_edit_error(
                "too_many_edits",
                (
                    f"单批最多暂存 {MAX_OUTLINE_EDIT_BATCH_EDITS} 个精确修改；"
                    "请按幕或最多 4 节拆分，并使用返回的 draft_revision 继续下一批。"
                ),
                revision=expected_revision,
            )
        batch_chars = sum(
            len(str(edit.get("section_heading") or ""))
            + len(str(edit.get("start_text") or ""))
            + len(str(edit.get("end_text") or ""))
            + len(str(edit.get("old_text") or ""))
            + len(str(edit.get("new_text", "")))
            for edit in edits
            if isinstance(edit, dict)
        )
        if batch_chars > MAX_OUTLINE_EDIT_BATCH_CHARS:
            return self._outline_edit_error(
                "outline_edit_batch_too_large",
                (
                    f"本批补丁共 {batch_chars} 字符，超过 {MAX_OUTLINE_EDIT_BATCH_CHARS} 字符上限；"
                    "请缩小到一个幕或最多 4 节，再分批暂存。"
                ),
                revision=expected_revision,
            )

        revised = working_source
        applied: list[dict[str, Any]] = []
        for index, edit in enumerate(edits):
            if not isinstance(edit, dict):
                return self._outline_edit_error(
                    "invalid_edit",
                    f"第 {index + 1} 个修改不是对象。",
                    revision=expected_revision,
                )
            section_heading = str(edit.get("section_heading", "")).strip()
            start_text = str(edit.get("start_text", "")).strip()
            end_text = str(edit.get("end_text", "")).strip()
            old_text = str(edit.get("old_text", ""))
            new_text = str(edit.get("new_text", ""))
            replace_all = bool(edit.get("replace_all", False))
            if section_heading:
                replacement = self._replace_markdown_section(
                    revised,
                    section_heading,
                    new_text,
                )
                if not replacement["ok"]:
                    return self._outline_edit_error(
                        str(replacement["error"]),
                        f"第 {index + 1} 个修改{replacement['message']}本批未写入。",
                        revision=expected_revision,
                        details={
                            "edit_index": index + 1,
                            "field_path": f"$.edits[{index}].section_heading",
                            "source_kind": source_kind,
                            "batch_applied": False,
                            "retry_base_revision": expected_revision,
                            **dict(replacement.get("details") or {}),
                        },
                    )
                revised = str(replacement["source"])
                applied.append(
                    {
                        "index": index + 1,
                        "mode": "section",
                        "section_heading": replacement["section_heading"],
                        "start_line": replacement["start_line"],
                        "end_line": replacement["end_line"],
                        "replacements": 1,
                        "replace_all": False,
                    }
                )
                continue
            if start_text or end_text:
                if not start_text or not end_text:
                    missing = "start_text" if not start_text else "end_text"
                    return self._outline_edit_error(
                        "missing_range_anchor",
                        (
                            f"第 {index + 1} 个修改缺少 {missing}；"
                            "范围替换只需同时提供 start_text 和 end_text。"
                        ),
                        revision=expected_revision,
                        details={
                            "edit_index": index + 1,
                            "field_path": f"$.edits[{index}].{missing}",
                            "batch_applied": False,
                        },
                    )
                replacement = self._replace_text_range(
                    revised,
                    start_text,
                    end_text,
                    new_text,
                )
                if not replacement["ok"]:
                    return self._outline_edit_error(
                        str(replacement["error"]),
                        f"第 {index + 1} 个修改{replacement['message']}本批未写入。",
                        revision=expected_revision,
                        details={
                            "edit_index": index + 1,
                            "field_paths": [
                                f"$.edits[{index}].start_text",
                                f"$.edits[{index}].end_text",
                            ],
                            "source_kind": source_kind,
                            "batch_applied": False,
                            "retry_base_revision": expected_revision,
                            **dict(replacement.get("details") or {}),
                        },
                    )
                revised = str(replacement["source"])
                applied.append(
                    {
                        "index": index + 1,
                        "mode": "range",
                        "automatic": False,
                        "start_line": replacement["start_line"],
                        "end_line": replacement["end_line"],
                        "replacements": 1,
                        "replace_all": False,
                    }
                )
                continue
            if not old_text:
                return self._outline_edit_error(
                    "missing_edit_selector",
                    (
                        f"第 {index + 1} 个修改没有定位信息；"
                        "整节用 section_heading，长范围用 start_text/end_text，"
                        "短句才用 old_text。"
                    ),
                    revision=expected_revision,
                    details={
                        "edit_index": index + 1,
                        "field_paths": [
                            f"$.edits[{index}].section_heading",
                            f"$.edits[{index}].start_text",
                            f"$.edits[{index}].end_text",
                            f"$.edits[{index}].old_text",
                        ],
                        "batch_applied": False,
                    },
                )
            occurrences = revised.count(old_text)
            if occurrences == 0:
                normalized_selection = select_normalized_text_span(revised, old_text)
                if normalized_selection["ok"]:
                    start = int(normalized_selection["start"])
                    end = int(normalized_selection["end"])
                    revised = revised[:start] + new_text + revised[end:]
                    applied.append(
                        {
                            "index": index + 1,
                            "mode": "normalized_text",
                            "automatic": True,
                            "normalizations": normalized_selection["details"][
                                "normalizations"
                            ],
                            "replacements": 1,
                            "replace_all": False,
                        }
                    )
                    continue
                if normalized_selection["error"] == "ambiguous_normalized_text":
                    return self._outline_edit_error(
                        "ambiguous_old_text",
                        (
                            f"第 {index + 1} 个 old_text 规范化引号与空白后匹配到多处；"
                            "请改用唯一的 start_text/end_text，本批未写入。"
                        ),
                        revision=expected_revision,
                        details={
                            "edit_index": index + 1,
                            "field_path": f"$.edits[{index}].old_text",
                            "source_kind": source_kind,
                            "batch_applied": False,
                            "retry_base_revision": expected_revision,
                            **dict(normalized_selection.get("details") or {}),
                        },
                    )
                anchor_selection: dict[str, Any] | None = None
                if len(old_text) >= LONG_OLD_TEXT_CHARS:
                    anchor_selection = select_folded_range_anchors(
                        revised,
                        old_text,
                        min_text_chars=LONG_OLD_TEXT_CHARS,
                    )
                    if anchor_selection["ok"]:
                        replacement = self._replace_text_range(
                            revised,
                            str(anchor_selection["start_text"]),
                            str(anchor_selection["end_text"]),
                            new_text,
                        )
                        if replacement["ok"]:
                            revised = str(replacement["source"])
                            applied.append(
                                {
                                    "index": index + 1,
                                    "mode": "range",
                                    "automatic": True,
                                    "anchor_chars": anchor_selection["details"][
                                        "anchor_chars"
                                    ],
                                    "start_line": replacement["start_line"],
                                    "end_line": replacement["end_line"],
                                    "replacements": 1,
                                    "replace_all": False,
                                }
                            )
                            continue
                    if anchor_selection["error"] == "ambiguous_text_range" or (
                        anchor_selection.get("details", {}).get("start_occurrences")
                        == 1
                        and anchor_selection.get("details", {}).get("end_occurrences")
                        == 1
                    ):
                        return self._outline_edit_error(
                            str(anchor_selection["error"]),
                            (
                                f"第 {index + 1} 个长 old_text 自动定位失败："
                                f"{anchor_selection['message']}本批未写入。"
                            ),
                            revision=expected_revision,
                            details={
                                "edit_index": index + 1,
                                "field_path": f"$.edits[{index}].old_text",
                                "source_kind": source_kind,
                                "batch_applied": False,
                                "retry_base_revision": expected_revision,
                                **dict(anchor_selection.get("details") or {}),
                            },
                        )
                diagnostics = self._outline_anchor_diagnostics(revised, old_text)
                anchor = str(diagnostics.get("anchor") or "")
                mismatch = diagnostics.get("first_difference")
                mismatch_offset = (
                    int(mismatch.get("offset", 0)) + 1
                    if isinstance(mismatch, dict)
                    else 0
                )
                source_label = "待确认草稿" if source_kind == "pending_draft" else "正式大纲"
                long_text = len(old_text) >= LONG_OLD_TEXT_CHARS
                if long_text:
                    diagnostics["suggested_old_text"] = ""
                    diagnostics["suggested_old_text_truncated"] = False
                    diagnostics.update(
                        dict(anchor_selection.get("details") or {})
                        if anchor_selection
                        else {}
                    )
                guidance = (
                    "这是长范围修改，不要再复制整段 old_text；"
                    "请改用当前内容中唯一的 start_text 和 end_text 定位首尾。"
                    if long_text
                    else
                    f"系统在{source_label}中找到了唯一锚点“{anchor}”，但提交文本"
                    f"从第 {mismatch_offset} 个字符开始不同。请直接复用 "
                    "details.suggested_old_text，"
                    "不要凭记忆重写 old_text。"
                    if (
                        anchor
                        and diagnostics.get("suggested_old_text")
                        and not diagnostics.get("suggested_old_text_truncated")
                    )
                    else (
                        f"请调用 read_outline(query={diagnostics.get('suggested_query')!r}) "
                        f"重新读取{source_label}，并逐字复制返回内容。"
                    )
                )
                return self._outline_edit_error(
                    "old_text_not_found",
                    (
                        f"第 {index + 1} 个修改的 old_text 未匹配当前{source_label}；"
                        f"本批未写入。{guidance}继续时使用 revision {expected_revision}。"
                    ),
                    revision=expected_revision,
                    details={
                        "edit_index": index + 1,
                        "field_path": f"$.edits[{index}].old_text",
                        "cause": "exact_text_mismatch",
                        "source_kind": source_kind,
                        "batch_applied": False,
                        "retry_base_revision": expected_revision,
                        "submitted_chars": len(old_text),
                        **diagnostics,
                    },
                )
            if occurrences > 1 and not replace_all:
                return self._outline_edit_error(
                    "ambiguous_old_text",
                    (
                        f"第 {index + 1} 个修改匹配到 {occurrences} 处；"
                        "请用 section_heading，或传唯一的 start_text/end_text。"
                    ),
                    revision=expected_revision,
                )
            revised = revised.replace(old_text, new_text, -1 if replace_all else 1)
            applied.append(
                {
                    "index": index + 1,
                    "mode": "text",
                    "replacements": occurrences if replace_all else 1,
                    "replace_all": replace_all,
                }
            )

        if revised == working_source:
            return self._outline_edit_error(
                "no_changes",
                "补丁没有产生任何内容变化。",
                revision=expected_revision,
            )

        self.save_outline_draft(revised, mode="incremental")
        state = self._load_outline_edit_state()
        state["edit_count"] = previous_edit_count + len(applied)
        state["applied"] = applied
        state["batch_count"] = previous_batch_count + 1
        state["final_batch"] = bool(final_batch)
        state["batches"] = [
            *previous_batches,
            {
                "index": previous_batch_count + 1,
                "label": str(batch_label or "").strip(),
                "edit_count": len(applied),
                "payload_chars": batch_chars,
                "final": bool(final_batch),
            },
        ]
        self._save_outline_edit_state(state)
        diff = self._outline_diff(canonical, revised)
        draft_revision = self._hash_text(revised)
        return {
            "ok": True,
            "blocked": False,
            "next_action": (
                "confirm_outline_edits" if final_batch else "continue_outline_edit_batches"
            ),
            "message": (
                "大纲全部批次已暂存，请向用户展示累计 diff 并等待确认；"
                "src/outline.md 尚未改变。"
                if final_batch
                else (
                    f"大纲第 {previous_batch_count + 1} 批已暂存；请使用 draft_revision "
                    "继续下一批，不要重复已完成的修改，也不要提前请求用户确认。"
                )
            ),
            "path": str(self.outline_src_path),
            "draft_path": str(self.outline_draft_path),
            "base_revision": canonical_revision,
            "draft_revision": draft_revision,
            "edit_count": previous_edit_count + len(applied),
            "applied": applied,
            "batch_count": previous_batch_count + 1,
            "batch_label": str(batch_label or "").strip(),
            "final_batch": bool(final_batch),
            "batch_limits": {
                "max_edits": MAX_OUTLINE_EDIT_BATCH_EDITS,
                "max_payload_chars": MAX_OUTLINE_EDIT_BATCH_CHARS,
            },
            "diff": diff,
        }

    def pending_outline_edit(self) -> dict[str, Any]:
        """读取当前待确认补丁及 diff。"""
        state = self._load_outline_edit_state()
        if not state or not self.outline_draft_path.exists():
            return self._outline_edit_error("missing_pending_edit", "当前没有待确认的大纲修改。")
        source = self.read_outline_source()
        draft = self.outline_draft_path.read_text(encoding="utf-8")
        return {
            "ok": True,
            "blocked": False,
            **state,
            "diff": self._outline_diff(source, draft),
            "path": str(self.outline_src_path),
            "draft_path": str(self.outline_draft_path),
        }

    def discard_outline_edit(self) -> dict[str, Any]:
        """丢弃待确认草稿并恢复为 canonical 大纲镜像。"""
        had_pending = self.outline_edit_state_path.exists()
        if self.outline_src_path.exists():
            self._atomic_write_text(self.outline_draft_path, self.read_outline_source())
        elif self.outline_draft_path.exists():
            self.outline_draft_path.unlink()
        self.outline_edit_state_path.unlink(missing_ok=True)
        return {
            "ok": True,
            "blocked": False,
            "discarded": had_pending,
            "next_action": "continue_planning",
            "message": "已丢弃待确认的大纲修改，src/outline.md 未改变。",
        }

    def read_outline_draft(self, max_chars: int = 0) -> str:
        if not self.outline_draft_path.exists():
            return ""
        text = self.outline_draft_path.read_text(encoding="utf-8").strip()
        if max_chars and len(text) > max_chars:
            return text[:max_chars]
        return text

    def outline_draft_is_current(self) -> bool:
        """判断 outline draft 是否与 canonical outline 保持完全一致。"""
        if not self.outline_src_path.exists() or not self.outline_draft_path.exists():
            return False
        return self.outline_src_path.read_text(
            encoding="utf-8"
        ) == self.outline_draft_path.read_text(encoding="utf-8")

    def outline_edit_batches_complete(self) -> bool:
        """判断分批增量编辑是否已经明确提交了最后一批。"""
        state = self._load_outline_edit_state()
        return not (
            state.get("mode") == "incremental"
            and "final_batch" in state
            and state.get("final_batch") is not True
        )

    def promote_outline(self, confirmed: bool) -> bool:
        """确认后原子写入 outline；revision 冲突时拒绝覆盖。"""
        if not confirmed:
            return False

        self.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
        self.outline_src_path.parent.mkdir(parents=True, exist_ok=True)

        if not self.outline_draft_path.exists():
            return False

        draft = self.outline_draft_path.read_text(encoding="utf-8")
        state = self._load_outline_edit_state()
        if state:
            if not self.outline_edit_batches_complete():
                return False
            source_exists = self.outline_src_path.exists()
            source = self.read_outline_source()
            if bool(state.get("base_exists", False)) != source_exists:
                return False
            if str(state.get("base_revision", "")) != self._hash_text(source):
                return False
            if str(state.get("draft_revision", "")) != self._hash_text(draft):
                return False
        elif self.outline_src_path.exists() and self.read_outline_source() != draft:
            # 旧项目没有 revision 元数据时，只接受本就一致的镜像，避免盲目覆盖。
            return False

        self._atomic_write_text(self.outline_src_path, draft)
        self._atomic_write_text(self.outline_draft_path, draft)
        self.outline_edit_state_path.unlink(missing_ok=True)
        return True

    def _save_outline_edit_state(self, state: dict[str, Any]) -> None:
        self.runtime_planning_dir.mkdir(parents=True, exist_ok=True)
        rendered = yaml.safe_dump(state, allow_unicode=True, sort_keys=False)
        self._atomic_write_text(self.outline_edit_state_path, rendered)

    def _load_outline_edit_state(self) -> dict[str, Any]:
        if not self.outline_edit_state_path.exists():
            return {}
        try:
            data = yaml.safe_load(self.outline_edit_state_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            return {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _outline_diff(before: str, after: str, max_chars: int = 16000) -> str:
        diff = "".join(
            difflib.unified_diff(
                before.splitlines(keepends=True),
                after.splitlines(keepends=True),
                fromfile="a/src/outline.md",
                tofile="b/src/outline.md",
            )
        )
        if len(diff) <= max_chars:
            return diff
        return diff[:max_chars] + "\n... diff 已截断 ...\n"

    @staticmethod
    def _outline_edit_error(
        error: str,
        message: str,
        *,
        revision: str = "",
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "ok": False,
            "blocked": True,
            "error": error,
            "message": message,
            "revision": revision,
            "details": details or {},
            "next_action": "read_outline",
        }

    @staticmethod
    def _replace_markdown_section(
        source: str,
        requested_heading: str,
        new_body: str,
    ) -> dict[str, Any]:
        lines = source.splitlines(keepends=True)
        requested = str(requested_heading or "").strip()
        requested_match = re.fullmatch(r"(#{1,6})[ \t]+(.+?)", requested)
        requested_level = len(requested_match.group(1)) if requested_match else 0
        requested_label = (
            requested_match.group(2).strip()
            if requested_match
            else requested.lstrip("#").strip()
        )
        headings: list[dict[str, Any]] = []
        offset = 0
        for index, line in enumerate(lines):
            plain = line.rstrip("\r\n")
            match = re.fullmatch(r"(#{1,6})[ \t]+(.+?)[ \t]*", plain)
            if match:
                headings.append(
                    {
                        "index": index,
                        "line": index + 1,
                        "level": len(match.group(1)),
                        "label": match.group(2).strip(),
                        "heading": plain,
                        "start": offset,
                        "content_start": offset + len(line),
                    }
                )
            offset += len(line)
        matches = [
            item
            for item in headings
            if item["label"] == requested_label
            and (not requested_level or item["level"] == requested_level)
        ]
        if not matches:
            return {
                "ok": False,
                "error": "section_heading_not_found",
                "message": f"找不到 Markdown 标题“{requested_heading}”；",
                "details": {
                    "submitted_heading": requested_heading,
                    "available_headings": [item["heading"] for item in headings[:80]],
                },
            }
        if len(matches) > 1:
            return {
                "ok": False,
                "error": "ambiguous_section_heading",
                "message": (
                    f"标题“{requested_heading}”匹配到 {len(matches)} 处；"
                    "请带上 Markdown 的 # 层级；"
                ),
                "details": {
                    "submitted_heading": requested_heading,
                    "matching_headings": [item["heading"] for item in matches],
                },
            }

        target = matches[0]
        end = len(source)
        end_line = len(lines)
        for item in headings:
            if item["index"] > target["index"] and item["level"] <= target["level"]:
                end = int(item["start"])
                end_line = int(item["line"]) - 1
                break
        heading_line = lines[int(target["index"])]
        newline = "\r\n" if heading_line.endswith("\r\n") else "\n"
        body = str(new_body or "").strip("\r\n")
        replacement = str(target["heading"]) + newline + newline
        if body:
            replacement += body + newline
        if end < len(source):
            replacement += newline
        return {
            "ok": True,
            "source": source[: int(target["start"])] + replacement + source[end:],
            "section_heading": target["heading"],
            "start_line": target["line"],
            "end_line": end_line,
        }

    @staticmethod
    def _replace_text_range(
        source: str,
        start_text: str,
        end_text: str,
        new_text: str,
    ) -> dict[str, Any]:
        start_anchor = str(start_text or "").strip()
        end_anchor = str(end_text or "").strip()
        if not start_anchor or not end_anchor:
            return {
                "ok": False,
                "error": "missing_range_anchor",
                "message": "范围替换需要同时提供 start_text 和 end_text；",
                "details": {},
            }
        start_spans = normalized_text_spans(source, start_anchor)
        end_spans = normalized_text_spans(source, end_anchor)
        if not start_spans or not end_spans:
            missing = []
            if not start_spans:
                missing.append("start_text")
            if not end_spans:
                missing.append("end_text")
            return {
                "ok": False,
                "error": "text_range_not_found",
                "message": f"找不到{'和'.join(missing)}锚点；",
                "details": {
                    "missing_anchors": missing,
                    "start_occurrences": len(start_spans),
                    "end_occurrences": len(end_spans),
                },
            }

        ranges: list[tuple[int, int]] = []
        if start_anchor == end_anchor:
            ranges = list(start_spans)
        else:
            for start, start_end in start_spans:
                for end, end_end in end_spans:
                    if end >= start_end:
                        ranges.append((start, end_end))
        if not ranges:
            return {
                "ok": False,
                "error": "text_range_not_found",
                "message": "找到了首尾锚点，但它们的顺序不成立；",
                "details": {
                    "start_occurrences": len(start_spans),
                    "end_occurrences": len(end_spans),
                },
            }
        if len(ranges) > 1:
            return {
                "ok": False,
                "error": "ambiguous_text_range",
                "message": (
                    f"首尾锚点组合成 {len(ranges)} 个可能范围；"
                    "请各增加几个字，直到只定位一处；"
                ),
                "details": {
                    "range_count": len(ranges),
                    "start_occurrences": len(start_spans),
                    "end_occurrences": len(end_spans),
                },
            }

        start, end = ranges[0]
        replacement = str(new_text or "")
        return {
            "ok": True,
            "source": source[:start] + replacement + source[end:],
            "start_line": source.count("\n", 0, start) + 1,
            "end_line": source.count("\n", 0, end) + 1,
        }

    @staticmethod
    def _outline_anchor_diagnostics(
        source: str,
        submitted: str,
        *,
        max_suggestion_chars: int = 6000,
    ) -> dict[str, Any]:
        """Find a stable line anchor and return the exact current block around it."""
        source_lines = source.splitlines(keepends=True)
        plain_source_lines = [line.rstrip("\r\n") for line in source_lines]
        submitted_lines = submitted.splitlines()
        nonempty = [line for line in submitted_lines if line.strip()]
        heading_lines = [line for line in nonempty if re.match(r"^#{1,6}\s+", line)]
        candidates = list(dict.fromkeys([*heading_lines, *nonempty[:6]]))

        anchor = ""
        anchor_index = -1
        for candidate in candidates:
            matches = [
                index for index, line in enumerate(plain_source_lines) if line == candidate
            ]
            if len(matches) == 1:
                anchor = candidate
                anchor_index = matches[0]
                break

        closest_line = ""
        similarity = 0.0
        if anchor_index < 0 and nonempty and plain_source_lines:
            target = nonempty[0]
            scored = (
                (difflib.SequenceMatcher(None, target, line).ratio(), index, line)
                for index, line in enumerate(plain_source_lines)
                if line.strip()
            )
            similarity, candidate_index, closest_line = max(
                scored,
                default=(0.0, -1, ""),
            )
            if similarity >= 0.55 and plain_source_lines.count(closest_line) == 1:
                anchor = closest_line
                anchor_index = candidate_index

        suggested = ""
        suggestion_truncated = False
        if anchor_index >= 0:
            end_index = min(
                len(source_lines),
                anchor_index + max(len(submitted_lines), 1),
            )
            heading_match = re.match(r"^(#{1,6})\s+", anchor)
            if heading_match:
                heading_level = len(heading_match.group(1))
                for index in range(anchor_index + 1, len(plain_source_lines)):
                    next_heading = re.match(r"^(#{1,6})\s+", plain_source_lines[index])
                    if next_heading and len(next_heading.group(1)) <= heading_level:
                        end_index = index
                        break
                else:
                    end_index = len(source_lines)
            suggested = "".join(source_lines[anchor_index:end_index])
            if len(suggested) > max_suggestion_chars:
                suggested = suggested[:max_suggestion_chars]
                suggestion_truncated = True

        first_difference: dict[str, Any] = {}
        if suggested:
            shared = min(len(submitted), len(suggested))
            offset = next(
                (index for index in range(shared) if submitted[index] != suggested[index]),
                shared,
            )
            if offset < max(len(submitted), len(suggested)):
                excerpt_start = max(0, offset - 40)
                excerpt_end = offset + 80
                first_difference = {
                    "offset": offset,
                    "submitted": submitted[excerpt_start:excerpt_end],
                    "current": suggested[excerpt_start:excerpt_end],
                }

        suggested_query = anchor or closest_line or (nonempty[0] if nonempty else "")
        return {
            "anchor": anchor,
            "anchor_line": anchor_index + 1 if anchor_index >= 0 else 0,
            "suggested_query": suggested_query[:240],
            "suggested_old_text": suggested,
            "suggested_old_text_truncated": suggestion_truncated,
            "closest_line": closest_line,
            "similarity": round(similarity, 3),
            "first_difference": first_difference,
        }

    @staticmethod
    def _atomic_write_text(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = ""
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
                temporary_path = handle.name
            os.replace(temporary_path, path)
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.unlink(temporary_path)

    def save_goethe_handoff(self, manifest: dict[str, Any]) -> tuple[Path, Path]:
        """保存 Goethe -> Dante 交接产物的 Markdown/YAML 双视图。"""
        self.workflow_dir.mkdir(parents=True, exist_ok=True)
        payload = dict(manifest)
        payload.setdefault("id", "goethe_handoff")
        payload.setdefault("type", "handoff")
        payload.setdefault("source_agent", "goethe")
        payload.setdefault("target_agent", "dante")
        payload.setdefault("next_stage", "chapter_preflight")
        payload.setdefault("ready", False)
        payload.setdefault("required_assets", [])

        ready_label = "是" if payload.get("ready") else "否"
        missing_items = payload.get("missing_items", [])
        missing_text = "、".join(str(item) for item in missing_items) if missing_items else "无"
        persona_paths = payload.get("persona_paths", [])
        persona_text = "、".join(str(item) for item in persona_paths) if persona_paths else "无"
        character_paths = payload.get("character_paths", [])
        character_text = (
            "、".join(str(item) for item in character_paths) if character_paths else "无"
        )

        # Markdown 版本给人快速审阅，YAML 版本给运行时和测试稳定读取。
        body = "\n".join(
            [
                "# Goethe -> Dante Handoff",
                "",
                "## Status",
                f"- ready: {ready_label}",
                f"- next_stage: {payload.get('next_stage', 'chapter_preflight')}",
                f"- source_agent: {payload.get('source_agent', 'goethe')}",
                f"- target_agent: {payload.get('target_agent', 'dante')}",
                "",
                "## Required Assets",
                "- " + "\n- ".join(str(item) for item in payload.get("required_assets", []))
                if payload.get("required_assets")
                else "- 无",
                "",
                "## Missing Items",
                f"- {missing_text}",
                "",
                "## Persona Paths",
                f"- {persona_text}",
                "",
                "## Character Paths",
                f"- {character_text}",
                "",
                "## Summary",
                str(payload.get("summary", "")).strip()
                or "Goethe 资产已整理完毕，可以交接给 Dante。",
            ]
        )
        self.goethe_handoff_md_path.write_text(
            compose_toml_document(
                {
                    "id": payload["id"],
                    "type": payload["type"],
                    "source_agent": payload["source_agent"],
                    "target_agent": payload["target_agent"],
                    "ready": bool(payload.get("ready")),
                    "next_stage": payload.get("next_stage", "chapter_preflight"),
                },
                body,
            ),
            encoding="utf-8",
        )
        self.goethe_handoff_yaml_path.write_text(
            yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        return self.goethe_handoff_md_path, self.goethe_handoff_yaml_path

    def list_character_documents(self) -> list[dict[str, str]]:
        """列出当前 canonical 角色文档，供 handoff 和 planning 检查使用。"""
        character_dir = self.novel_root / "src" / "characters"
        if not character_dir.exists():
            return []

        documents: list[dict[str, str]] = []
        for path in sorted(character_dir.glob("*.md")):
            text = path.read_text(encoding="utf-8")
            meta, body = parse_toml_front_matter(text)
            normalized_body = strip_front_matter_padding(body if meta else text)
            title = self._extract_document_title(normalized_body, path.stem)
            documents.append(
                {
                    "id": str(meta.get("id", path.stem)).strip() or path.stem,
                    "title": title,
                    "path": str(path),
                }
            )
        return documents

    def load_story_document(self, kind: str) -> dict[str, object]:
        """Load a promoted story document and expose metadata plus body."""
        path = self.story_src_dir / f"{kind}.md"
        if not path.exists():
            return {"path": path, "meta": {}, "body": ""}

        text = path.read_text(encoding="utf-8")
        meta, body = parse_toml_front_matter(text)
        normalized_body = strip_front_matter_padding(body if meta else text)
        if not meta:
            meta = self._default_story_metadata(kind, normalized_body)
        return {"path": path, "meta": meta, "body": normalized_body}

    def read_story_document(self, kind: str, max_chars: int = 0) -> str:
        """Return a compact AI-friendly rendering of a story source document."""
        document = self.load_story_document(kind)
        meta = document["meta"] if isinstance(document["meta"], dict) else {}
        body = str(document["body"])
        parts = []
        summary = str(meta.get("summary", "")).strip()
        detail_refs = meta.get("detail_refs", [])
        if summary:
            parts.append(f"摘要：{summary}")
        if isinstance(detail_refs, list) and detail_refs:
            parts.append("细节索引：" + "、".join(str(item) for item in detail_refs))
        if body:
            parts.append(body)
        text = "\n".join(parts).strip()
        if max_chars and len(text) > max_chars:
            return text[:max_chars]
        return text

    def _normalize_story_document(self, kind: str, text: str) -> str:
        """把 story 文档规整成 `TOML front matter + Markdown body` 统一格式。"""
        meta, body = parse_toml_front_matter(text)
        normalized_body = strip_front_matter_padding(body if meta else text)
        normalized_meta = meta or self._default_story_metadata(kind, normalized_body)
        return compose_toml_document(normalized_meta, normalized_body)

    @staticmethod
    def _story_document_has_content(text: str) -> bool:
        meta, body = parse_toml_front_matter(str(text or ""))
        candidate = strip_front_matter_padding(body if meta else str(text or ""))
        for line in candidate.splitlines():
            cleaned = line.strip()
            if not cleaned or cleaned.startswith("#"):
                continue
            cleaned = re.sub(r"^[>\-*+\s]+", "", cleaned).strip()
            cleaned = re.sub(
                r"[（(]?\s*(?:待填写|待定义|TODO|TBD).*?[）)]?$",
                "",
                cleaned,
                flags=re.IGNORECASE,
            ).strip()
            if cleaned:
                return True
        return False

    def _default_story_metadata(self, kind: str, body: str) -> dict[str, object]:
        summary = self._extract_story_summary(body)
        detail_refs = {
            "background": ["premise", "conflict", "tone"],
            "foundation": ["protagonist", "rules", "stakes"],
        }.get(kind, ["details"])
        return {
            "id": f"story_{kind}",
            "type": "story_document",
            "summary": summary,
            "detail_refs": detail_refs,
        }

    def _extract_story_summary(self, body: str) -> str:
        for line in body.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("#"):
                continue
            return stripped[:160]
        return body.strip()[:160]

    def _extract_document_title(self, body: str, fallback: str) -> str:
        for line in body.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("#"):
                title = stripped.lstrip("#").strip()
                return title or fallback
        return fallback

    def _hash_text(self, text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()
