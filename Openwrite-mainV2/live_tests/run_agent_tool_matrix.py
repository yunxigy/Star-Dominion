"""Run every Studio-exposed Goethe/Dante tool through a real Agent turn.

This diagnostic intentionally targets the one manual QA project, ``~/my_novel``.
It talks to the running Studio HTTP API so a passing result proves that model tool
selection, Agent dispatch, the executor, and Studio activity reporting all worked.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tools.agent.tool_runtime import build_tool_executors
from tools.reference_library import ReferenceLibraryService, default_reference_library_root
from tools.story_planning import StoryPlanningStore

REPO_ROOT = Path(__file__).resolve().parents[1]
QA_PROJECT = (Path.home() / "my_novel").resolve()
NOVEL_ID = "mujianzhe"
WRITE_HEADER = "X-OpenWrite-Studio"
EXPECTED_GUARDS = {
    "cancel_chapter_run_v2",
    "confirm_outline_scope",
    "confirm_foundation",
    "generate_outline_draft",
}
CONFIRMATION_TOOLS = {
    "apply_reference_adoption",
    "confirm_character_draft",
    "confirm_foundation",
    "promote_source_pack",
    "update_chapter_intervention",
}
CONFIRMATION_TEXT = {
    "apply_reference_adoption": "用户确认应用参考采纳预览。",
    "confirm_character_draft": "用户确认应用角色草案。",
    "confirm_foundation": "用户确认应用基础设定草案。",
    "confirm_outline_edits": "用户确认应用大纲修改。",
    "edit_world_relations": "用户确认应用关系修改。",
    "promote_source_pack": "用户确认应用来源包晋升。",
    "update_chapter_intervention": "用户确认应用干预状态修改。",
}
MUTATING_TOOLS = {
    "apply_reference_adoption",
    "confirm_character_draft",
    "confirm_foundation",
    "confirm_outline_edits",
    "create_character",
    "delegate_chapter_write",
    "edit_project_document",
    "edit_outline_structure",
    "edit_world_relation",
    "edit_world_relations",
    "extract_setting_source",
    "extract_style_source",
    "generate_character_draft",
    "generate_foundation_draft",
    "generate_outline_draft",
    "promote_source_pack",
    "record_chapter_intervention",
    "stage_outline_edits",
    "summarize_ideation",
    "update_chapter_intervention",
}


@dataclass(frozen=True)
class ToolCase:
    key: str
    tool: str
    agent: str
    explicit_confirmation: bool = False


@dataclass
class ToolResult:
    key: str
    tool: str
    agent: str
    run_id: str
    session_id: str
    arguments: dict[str, Any]
    calls: list[str]
    completion_ok: bool | None
    activity_status: str
    run_completed: bool
    contract_passed: bool
    functional_passed: bool
    expected_guard: bool
    policy_blocked: bool
    elapsed_seconds: float
    response_excerpt: str
    error: str = ""


def _json_excerpt(value: Any, limit: int = 12000) -> str:
    text = str(value or "")
    return text[:limit] + ("..." if len(text) > limit else "")


class StudioClient:
    def __init__(self, base_url: str, timeout: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get(self, route: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = urllib.parse.urlencode(params or {})
        url = f"{self.base_url}{route}" + (f"?{query}" if query else "")
        request = urllib.request.Request(url, method="GET")
        return self._request(request)

    def post(self, route: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self.base_url}{route}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", WRITE_HEADER: "1"},
            method="POST",
        )
        return self._request(request)

    def _request(self, request: urllib.request.Request) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Studio HTTP {exc.code}: {body[:1000]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Studio unavailable: {exc.reason}") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("Studio returned a non-object response")
        if payload.get("ok") is True and isinstance(payload.get("data"), dict):
            return dict(payload["data"])
        if payload.get("error"):
            raise RuntimeError(str(payload["error"]))
        return payload


class MatrixRuntime:
    def __init__(self, client: StudioClient, artifact_path: Path) -> None:
        self.client = client
        self.artifact_path = artifact_path
        self.direct = build_tool_executors(QA_PROJECT)
        self.planning = StoryPlanningStore(QA_PROJECT, NOVEL_ID)
        self.results: list[ToolResult] = []
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.run_stamp = datetime.now().strftime("%m%d%H%M%S")

    def verify_workspace(self) -> None:
        workspace = self.client.get("/api/workspace")
        actual = Path(str(workspace.get("project", {}).get("root") or "")).resolve()
        if actual != QA_PROJECT:
            raise RuntimeError(
                f"Studio must be opened on {QA_PROJECT}; current project is {actual}"
            )
        if str(workspace.get("snapshot", {}).get("novel_id") or "") != NOVEL_ID:
            raise RuntimeError(f"Studio project must use novel_id={NOVEL_ID}")

    def catalogs(self) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for agent in ("goethe", "dante"):
            surface = self.client.get(
                "/api/agents",
                {"agent": agent, "session_id": f"qa-matrix-{agent}", "limit": 1},
            )
            result[agent] = [
                str(item.get("name") or "")
                for item in surface.get("tools", [])
                if isinstance(item, dict) and item.get("name")
            ]
        return result

    def arguments_for(self, case: ToolCase) -> dict[str, Any]:
        tool = case.tool
        if tool in {
            "get_status",
            "diagnose_runtime",
            "get_runtime_state",
            "get_truth_files",
            "get_world_relations",
            "list_chapters",
            "list_reference_library",
            "prepare_dante_handoff",
            "summarize_ideation",
            "confirm_outline_scope",
            "confirm_outline_edits",
            "discard_outline_edits",
        }:
            return {}
        if tool == "get_context":
            return {"chapter_id": "ch_001", "window_size": 3}
        if tool == "inspect_agent_context":
            return {"chapter_id": "ch_001", "agent": "writer"}
        if tool == "list_chapter_runs":
            return {"chapter_id": "ch_001", "limit": 5}
        if tool == "get_chapter_run_v2":
            run = self._chapter_run()
            return {"action": "get", "run_id": run["run_id"]}
        if tool == "record_chapter_intervention":
            run = self._chapter_run()
            return {
                "run_id": run["run_id"],
                "revision": run["revision"],
                "scope": "chapter",
                "risk": "low",
                "request": f"Agent 全工具矩阵回归 {self.run_stamp}",
                "affected_items": ["ch_001"],
                "rewrite_required": False,
            }
        if tool == "update_chapter_intervention":
            run = self._chapter_run()
            intervention = run.get("interventions", [])[-1]
            return {
                "run_id": run["run_id"],
                "revision": run["revision"],
                "intervention_id": intervention["intervention_id"],
                "state": "facts_read",
                "impact": ["矩阵回归：不要求重写正文"],
                "proposal": "保留现状，仅验证干预状态机。",
                "confirm": False,
            }
        if tool == "cancel_chapter_run_v2":
            run = self._chapter_run()
            return {
                "run_id": run["run_id"],
                "revision": run["revision"],
                "reason": "验证已完成 run 的取消保护",
            }
        if tool == "manage_rolling_plan":
            return {"action": "list", "limit": 5}
        if tool == "manage_manuscript_versions":
            return {"action": "list", "chapter_id": "ch_001"}
        if tool == "manage_annotations":
            return {"action": "list", "chapter_id": "ch_001"}
        if tool == "get_chapter_review":
            return {"chapter_id": "ch_001"}
        if tool == "get_task_activity":
            return {"limit": 5}
        if tool == "get_goethe_handoff":
            return {"max_chars": 3000}
        if tool == "query_library":
            return {"scope": "characters", "query": "沈烬", "limit": 10}
        if tool == "search_project":
            return {"query": "归墟", "scope": "all", "limit": 8}
        if tool == "read_project_document":
            return {"path": "src/characters/shen_jin.md", "max_chars": 3000}
        if tool == "edit_project_document":
            document = self.direct["read_project_document"](
                {"path": "src/story/author_intent.md", "max_chars": 20000}
            )
            return {
                "path": document["path"],
                "revision": document["revision"],
                "edits": [
                    {
                        "old_text": "# 作者意图",
                        "new_text": "# 作者意图（矩阵预览）",
                    }
                ],
                "confirm": False,
            }
        if tool == "get_outline_structure":
            return {"chapter_id": "ch_001"}
        if tool == "edit_outline_structure":
            outline = self.direct["get_outline_structure"]({})
            root = outline["roots"][0]
            return {
                "operation": "rename",
                "revision": outline["revision"],
                "node_id": root["id"],
                "title": f"{root['title']}（矩阵预览）",
                "confirm": False,
            }
        if tool == "create_character":
            return {
                "name": f"矩阵验收角色{self.run_stamp}",
                "description": "专用于真实 Agent 工具矩阵，不参与正篇。",
            }
        if tool == "get_character_state":
            return {"name": "沈烬", "lookback": 10}
        if tool == "query_world":
            return {"entity_id": "guixu"}
        if tool == "search_relation_targets":
            return {"query": "伶舟", "limit": 10}
        if tool == "edit_world_relation":
            return {
                "source_id": "端测记录员",
                "target_id": "xuyan_dao",
                "description": "矩阵单关系预览",
                "action": "upsert",
                "confirm": False,
            }
        if tool == "edit_world_relations":
            if case.key.endswith("_apply"):
                return {"confirm": True}
            action = "remove" if "cleanup" in case.key else "upsert"
            return {
                "relations": [
                    {
                        "source_id": "端测记录员",
                        "target_id": "xuyan_dao",
                        "description": "矩阵批量关系回归",
                        "action": action,
                    }
                ],
                "confirm": False,
            }
        if tool == "confirm_ideation_summary":
            return {"text": "确认当前想法汇总用于全工具矩阵回归"}
        if tool == "generate_foundation_draft":
            return {"request_text": "基于现有测试小说生成兼容性基础设定辅助草案"}
        if tool == "confirm_foundation":
            return {"confirm": True}
        if tool == "generate_character_draft":
            return {"request_text": "新增角色矩阵草案记录员，定位为普通配角"}
        if tool == "confirm_character_draft":
            return {"character_id": self._latest_character_draft(), "confirm": True}
        if tool == "generate_outline_draft":
            return {"request_text": "基于当前资产生成四级大纲草案"}
        if tool == "read_outline":
            return {"query": "第1章"}
        if tool == "stage_outline_edits":
            return self._outline_stage_arguments(case.key)
        if tool == "extract_style_source":
            return {
                "source_id": "qa_matrix_style",
                "source": (
                    "雨停后，修表匠把最后一枚齿轮放回木盒。门外无人催促，"
                    "只有檐水按稳定节拍落下。他说：先听，再决定要不要开门。"
                ),
            }
        if tool == "extract_setting_source":
            return {
                "source_id": "qa_matrix_setting",
                "source": (
                    "旧港每逢退潮会露出一排编号门。居民只能在铜钟响过三次后通行，"
                    "门后的房间会记录访客说过但没有兑现的承诺。"
                ),
            }
        if tool == "review_source_pack":
            return {"source_id": "qa_matrix_style"}
        if tool == "promote_source_pack":
            return {"source_id": "qa_matrix_style", "target": "style"}
        if tool == "review_reference_source":
            return {"source_id": self._reference_source_id()}
        if tool == "review_reference_profile":
            return {"profile_id": self._reference_profile_id()}
        if tool == "preview_reference_adoption":
            return self._reference_preview_arguments()
        if tool == "apply_reference_adoption":
            return {"preview_id": self._latest_reference_preview_id(), "confirm": True}
        if tool == "run_chapter_preflight":
            return {"chapter_id": self._next_chapter_id()}
        if tool == "delegate_chapter_write":
            return {
                "chapter_id": self._next_chapter_id(),
                "target_words": 1200,
                "guidance": "全功能回归稿；严格遵守当前章纲，不提前揭示后续真相。",
            }
        if tool == "delegate_chapter_review":
            return {
                "chapter_id": self._latest_written_chapter(),
                "dimensions": [1, 2, 3],
                "strict": False,
            }
        raise RuntimeError(f"No matrix arguments configured for {case.key}/{tool}")

    def run_case(self, case: ToolCase, retries: int) -> ToolResult:
        session_id = f"qa-matrix-{case.agent}-{self.run_stamp}"
        try:
            arguments = self.arguments_for(case)
        except Exception as exc:
            result = ToolResult(
                key=case.key,
                tool=case.tool,
                agent=case.agent,
                run_id="",
                session_id=session_id,
                arguments={},
                calls=[],
                completion_ok=None,
                activity_status="dependency_error",
                run_completed=False,
                contract_passed=False,
                functional_passed=False,
                expected_guard=case.tool in EXPECTED_GUARDS,
                policy_blocked=False,
                elapsed_seconds=0.0,
                response_excerpt="",
                error=str(exc),
            )
            self.results.append(result)
            self.write_artifact()
            return result
        confirmation = CONFIRMATION_TEXT.get(case.tool, "") if case.explicit_confirmation else ""
        prompt = (
            f"这是全工具真实回归。只调用 {case.tool}，一次且仅一次。"
            "不得调用其他工具，不得省略调用，也不要在失败后改用别的工具。"
            f"{confirmation}参数必须严格使用下面的 JSON：\n"
            f"{json.dumps(arguments, ensure_ascii=False)}\n"
            "工具完成后用一句话如实报告结果。"
        )
        last: ToolResult | None = None
        for attempt in range(retries + 1):
            run_id = f"matrix-{self.run_stamp}-{case.key}-{attempt + 1}"
            started = time.monotonic()
            try:
                response = self.client.post(
                    "/api/chat",
                    {
                        "agent": case.agent,
                        "session_id": session_id,
                        "run_id": run_id,
                        "message": prompt,
                    },
                )
                activity = self.client.get("/api/agent/activity", {"run_id": run_id})
                result = classify_result(
                    case,
                    run_id,
                    session_id,
                    arguments,
                    activity,
                    str(response.get("content") or ""),
                    time.monotonic() - started,
                )
            except Exception as exc:
                result = ToolResult(
                    key=case.key,
                    tool=case.tool,
                    agent=case.agent,
                    run_id=run_id,
                    session_id=session_id,
                    arguments=arguments,
                    calls=[],
                    completion_ok=None,
                    activity_status="error",
                    run_completed=False,
                    contract_passed=False,
                    functional_passed=False,
                    expected_guard=case.tool in EXPECTED_GUARDS,
                    policy_blocked=False,
                    elapsed_seconds=round(time.monotonic() - started, 3),
                    response_excerpt="",
                    error=str(exc),
                )
            last = result
            if result.contract_passed:
                break
        assert last is not None
        self.results.append(last)
        self.write_artifact()
        return last

    def write_artifact(self) -> None:
        payload = {
            "schema_version": 1,
            "started_at": self.started_at,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "studio_url": self.client.base_url,
            "project": str(QA_PROJECT),
            "novel_id": NOVEL_ID,
            "summary": {
                "cases": len(self.results),
                "unique_tools": len({item.tool for item in self.results}),
                "contract_passed": sum(item.contract_passed for item in self.results),
                "functional_passed": sum(item.functional_passed for item in self.results),
                "failed": sum(not item.contract_passed for item in self.results),
            },
            "results": [asdict(item) for item in self.results],
        }
        self.artifact_path.parent.mkdir(parents=True, exist_ok=True)
        self.artifact_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _chapter_run(self) -> dict[str, Any]:
        payload = self.direct["get_chapter_run_v2"]({"action": "list", "limit": 20})
        runs = payload.get("runs", [])
        if not runs:
            raise RuntimeError("No Chapter Run V2 fixture is available")
        return runs[0]

    def _latest_character_draft(self) -> str:
        root = self.planning.runtime_planning_dir / "characters"
        paths = sorted(root.glob("*.md"), key=lambda path: path.stat().st_mtime, reverse=True)
        if not paths:
            raise RuntimeError("generate_character_draft did not create a draft")
        return paths[0].stem

    def _outline_stage_arguments(self, key: str) -> dict[str, Any]:
        content = self.planning.read_outline_source()
        revision = self.planning.outline_source_revision()
        original = "> 戏剧位置: 起"
        marker = "> 戏剧位置: 起（矩阵确认回归）"
        restore = "restore" in key
        old_text, new_text = (marker, original) if restore else (original, marker)
        if old_text not in content:
            raise RuntimeError(f"Outline fixture is missing expected text: {old_text}")
        return {
            "base_revision": revision,
            "edits": [{"old_text": old_text, "new_text": new_text}],
        }

    def _reference_service(self) -> ReferenceLibraryService:
        return ReferenceLibraryService(
            default_reference_library_root(),
            project_root=QA_PROJECT,
            novel_id=NOVEL_ID,
        )

    def _reference_source_id(self) -> str:
        items = self._reference_service().list()
        ready = [
            item
            for item in items
            if bool((item.get("analysis") or {}).get("complete"))
        ]
        if not ready:
            raise RuntimeError("No analyzed reference source fixture is available")
        return str((ready[0].get("record") or {}).get("source_id") or "")

    def _reference_profile_id(self) -> str:
        profiles = self._reference_service().list_profiles()
        if not profiles:
            raise RuntimeError("No reference profile fixture is available")
        return str(profiles[0]["profile_id"])

    def _reference_preview_arguments(self) -> dict[str, Any]:
        service = self._reference_service()
        profile = service.profile(self._reference_profile_id()).model_dump(mode="json")
        candidates = profile.get("common_methods") or profile.get("optional_variants") or []
        if not candidates:
            raise RuntimeError("Reference profile has no adoptable items")
        item = candidates[0]
        item_id = str(item.get("item_id") or item.get("id") or "")
        if not item_id:
            raise RuntimeError("Reference profile item has no item_id")
        return {
            "profile_id": profile["profile_id"],
            "selections": [
                {
                    "item_id": item_id,
                    "target": "inspiration",
                    "role": "primary",
                    "scope": "project",
                }
            ],
        }

    def _latest_reference_preview_id(self) -> str:
        root = default_reference_library_root() / "adoption-previews"
        paths = sorted(root.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
        if not paths:
            raise RuntimeError("preview_reference_adoption did not create a preview")
        payload = json.loads(paths[0].read_text(encoding="utf-8"))
        preview_id = str(payload.get("preview_id") or paths[0].stem)
        return preview_id

    def _next_chapter_id(self) -> str:
        outline = self.direct["get_outline_structure"]({})
        recommendation = outline.get("recommendation") or {}
        chapter_id = str(recommendation.get("chapter_id") or "")
        return chapter_id or "ch_002"

    def _latest_written_chapter(self) -> str:
        chapters = self.direct["list_chapters"]({}).get("chapters", [])
        if not chapters:
            raise RuntimeError("No manuscript is available for review")
        return str(chapters[-1]["chapter_id"])


def classify_result(
    case: ToolCase,
    run_id: str,
    session_id: str,
    arguments: dict[str, Any],
    activity: dict[str, Any],
    response: str,
    elapsed_seconds: float,
) -> ToolResult:
    events = [item for item in activity.get("events", []) if isinstance(item, dict)]
    calls = [
        str(item.get("tool") or "")
        for item in events
        if item.get("event") == "tool_started"
    ]
    completions = [
        item
        for item in events
        if item.get("event") == "tool_completed" and item.get("tool") == case.tool
    ]
    completion_ok = completions[-1].get("ok") if completions else None
    run_completed = any(item.get("event") == "run_completed" for item in events)
    expected_guard = case.tool in EXPECTED_GUARDS
    policy_blocked = "explicit_user_confirmation_required" in response
    contract_passed = (
        calls == [case.tool]
        and bool(completions)
        and str(activity.get("status") or "") == "complete"
        and run_completed
    )
    functional_passed = contract_passed and completion_ok is not False and not policy_blocked
    if expected_guard and contract_passed and completion_ok is False and not policy_blocked:
        functional_passed = True
    return ToolResult(
        key=case.key,
        tool=case.tool,
        agent=case.agent,
        run_id=run_id,
        session_id=session_id,
        arguments=arguments,
        calls=calls,
        completion_ok=completion_ok,
        activity_status=str(activity.get("status") or ""),
        run_completed=run_completed,
        contract_passed=contract_passed,
        functional_passed=functional_passed,
        expected_guard=expected_guard,
        policy_blocked=policy_blocked,
        elapsed_seconds=round(elapsed_seconds, 3),
        response_excerpt=_json_excerpt(response),
    )


def build_cases(catalogs: dict[str, list[str]]) -> list[ToolCase]:
    goethe = catalogs["goethe"]
    dante = catalogs["dante"]
    dante_only = [tool for tool in dante if tool not in goethe]
    replaced = {
        "stage_outline_edits",
        "confirm_outline_edits",
        "discard_outline_edits",
        "edit_world_relations",
    }
    cases = [
        ToolCase(
            tool,
            tool,
            "goethe",
            explicit_confirmation=tool in CONFIRMATION_TOOLS,
        )
        for tool in goethe
        if tool not in replaced
    ]

    relation_index = next(
        index for index, case in enumerate(cases) if case.tool == "edit_world_relation"
    ) + 1
    relation_cases = [
        ToolCase("edit_world_relations_add_preview", "edit_world_relations", "goethe"),
        ToolCase(
            "edit_world_relations_add_apply",
            "edit_world_relations",
            "goethe",
            explicit_confirmation=True,
        ),
        ToolCase("edit_world_relations_cleanup_preview", "edit_world_relations", "goethe"),
        ToolCase(
            "edit_world_relations_cleanup_apply",
            "edit_world_relations",
            "goethe",
            explicit_confirmation=True,
        ),
    ]
    cases[relation_index:relation_index] = relation_cases

    outline_index = next(index for index, case in enumerate(cases) if case.tool == "read_outline")
    outline_cases = [
        ToolCase("stage_outline_add", "stage_outline_edits", "goethe"),
        ToolCase(
            "confirm_outline_add",
            "confirm_outline_edits",
            "goethe",
            explicit_confirmation=True,
        ),
        ToolCase("stage_outline_restore", "stage_outline_edits", "goethe"),
        ToolCase(
            "confirm_outline_restore",
            "confirm_outline_edits",
            "goethe",
            explicit_confirmation=True,
        ),
        ToolCase("stage_outline_discard", "stage_outline_edits", "goethe"),
        ToolCase("discard_outline", "discard_outline_edits", "goethe"),
    ]
    cases[outline_index + 1 : outline_index + 1] = outline_cases
    cases.extend(ToolCase(tool, tool, "dante") for tool in dante_only)
    return cases


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument("--allow-writes", action="store_true")
    parser.add_argument(
        "--tools",
        default="",
        help="Comma-separated tool or case keys; default runs the complete matrix.",
    )
    parser.add_argument("--artifact", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifact = (
        args.artifact.resolve()
        if args.artifact
        else REPO_ROOT / "live_test_artifacts" / f"agent-tool-matrix-{stamp}.json"
    )
    runtime = MatrixRuntime(StudioClient(args.base_url, args.timeout), artifact)
    runtime.verify_workspace()
    catalogs = runtime.catalogs()
    cases = build_cases(catalogs)
    requested = {item.strip() for item in args.tools.split(",") if item.strip()}
    if requested:
        cases = [case for case in cases if case.key in requested or case.tool in requested]
        missing = requested - {case.key for case in cases} - {case.tool for case in cases}
        if missing:
            raise RuntimeError(f"Unknown requested tools/cases: {sorted(missing)}")
    if not args.allow_writes and any(case.tool in MUTATING_TOOLS for case in cases):
        raise RuntimeError("The selected matrix includes writes; rerun with --allow-writes")

    unique_tools = {case.tool for case in cases}
    exposed = set(catalogs["goethe"]) | set(catalogs["dante"])
    if not requested and unique_tools != exposed:
        missing = sorted(exposed - unique_tools)
        extra = sorted(unique_tools - exposed)
        raise RuntimeError(f"Matrix/catalog mismatch: missing={missing}, extra={extra}")

    print(
        f"Running {len(cases)} cases for {len(unique_tools)} unique tools "
        f"against {QA_PROJECT}"
    )
    for index, case in enumerate(cases, 1):
        result = runtime.run_case(case, retries=max(0, args.retries))
        status = "PASS" if result.contract_passed and result.functional_passed else "FAIL"
        print(
            f"[{index:02d}/{len(cases):02d}] {status} "
            f"{case.agent}.{case.key} ({result.elapsed_seconds:.1f}s)"
        )
        if result.error:
            print(f"  {result.error}")

    runtime.write_artifact()
    failed = [
        item
        for item in runtime.results
        if not item.contract_passed or not item.functional_passed
    ]
    print(f"Artifact: {artifact}")
    print(
        f"Contract pass: {sum(item.contract_passed for item in runtime.results)}/"
        f"{len(runtime.results)}; functional pass: "
        f"{sum(item.functional_passed for item in runtime.results)}/{len(runtime.results)}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
