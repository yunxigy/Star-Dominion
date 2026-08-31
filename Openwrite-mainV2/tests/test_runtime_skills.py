from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from models.runtime_skills import SkillManifestV1
from tools.agent.dante import DanteChatAgent
from tools.agent.toolkits import DANTE_DIRECT_TOOLKIT
from tools.goethe import GoetheChatAgent
from tools.init_project import init_project
from tools.runtime_skills import (
    RuleCompiler,
    RuntimeSkillResolver,
    extract_explicit_skill_mentions,
    render_runtime_context,
)
from tools.runtime_skills.resolver import RuntimeSkillError
from tools.studio_application import StudioApplication


def _write_skill(root: Path, skill_id: str, **manifest: object) -> Path:
    skill = root / skill_id
    skill.mkdir(parents=True, exist_ok=True)
    data = {
        "schema_version": 1,
        "id": skill_id,
        "version": "1.0.0",
        "name": skill_id,
        "agents": ["dante"],
        "allow_tools": ["get_status"],
        **manifest,
    }
    (skill / "manifest.yaml").write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    (skill / "instructions.md").write_text("执行边界。", encoding="utf-8")
    return skill


def _write_standard_skill(root: Path, skill_id: str) -> Path:
    skill = root / skill_id
    references = skill / "references"
    references.mkdir(parents=True, exist_ok=True)
    (skill / "SKILL.md").write_text(
        """---
name: 场景诊断
description: 用因果链和人物选择检查场景。
version: 1.2.0
allow_tools: [get_status]
references: [references/checklist.md]
---

先列出场景目标，再检查阻力、选择、代价和结果。
""",
        encoding="utf-8",
    )
    (references / "checklist.md").write_text(
        "每项结论必须引用当前场景证据。", encoding="utf-8"
    )
    scripts = skill / "scripts"
    scripts.mkdir()
    (scripts / "unsafe.sh").write_text("exit 99\n", encoding="utf-8")
    return skill


def test_manifest_is_strict_and_versioned() -> None:
    with pytest.raises(ValueError):
        SkillManifestV1.model_validate(
            {
                "schema_version": 1,
                "id": "strict-skill",
                "version": "1.0.0",
                "name": "strict",
                "unexpected": True,
            }
        )


def test_project_skill_can_only_narrow_agent_tools(tmp_path: Path) -> None:
    skill_root = tmp_path / ".openwrite" / "skills"
    _write_skill(skill_root, "narrow", allow_tools=["get_status"])
    resolution = RuntimeSkillResolver(tmp_path).resolve(
        agent="dante",
        task="chapter.write",
        base_tools=DANTE_DIRECT_TOOLKIT,
        explicit_skills=["narrow"],
    )
    assert set(resolution.allowed_tools) == {"get_status"}
    assert "write_chapter" not in resolution.allowed_tools


def test_wildcard_still_intersects_with_baseline(tmp_path: Path) -> None:
    skill_root = tmp_path / ".openwrite" / "skills"
    _write_skill(skill_root, "wild", allow_tools=["*"])
    resolution = RuntimeSkillResolver(tmp_path).resolve(
        agent="dante",
        base_tools={"get_status", "write_chapter"},
        explicit_skills=["wild"],
    )
    assert set(resolution.allowed_tools) == {"get_status", "write_chapter"}


def test_standard_skill_is_explicit_only_and_references_are_bounded(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    _write_standard_skill(project_root / ".agents" / "skills", "scene-diagnosis")
    resolver = RuntimeSkillResolver(project_root, global_root=tmp_path / "global")

    listed = resolver.list_skills()
    standard = next(item for item in listed["skills"] if item["id"] == "scene-diagnosis")
    assert standard["source_format"] == "standard-skill-md"
    assert standard["activation"] == "explicit"

    automatic = resolver.resolve(
        agent="dante",
        task="chapter.write",
        base_tools={"get_status", "write_chapter"},
    )
    assert "scene-diagnosis" not in {item.id for item in automatic.skills}

    explicit = resolver.resolve(
        agent="dante",
        task="chapter.write",
        base_tools={"get_status", "write_chapter"},
        explicit_skills=["scene-diagnosis"],
    )
    assert [item.id for item in explicit.skills] == ["scene-diagnosis"]
    assert set(explicit.allowed_tools) == {"get_status"}
    assert "先列出场景目标" in explicit.instructions
    rendered = render_runtime_context(explicit)
    assert "每项结论必须引用当前场景证据" in rendered
    assert "unsafe.sh" not in rendered


def test_builtin_oh_story_suite_is_explicit_bounded_and_attributed(
    tmp_path: Path,
) -> None:
    resolver = RuntimeSkillResolver(tmp_path, global_root=tmp_path / "global")
    listed = resolver.list_skills()
    expected_ids = {
        "oh-story-long-write",
        "oh-story-short-write",
        "oh-story-long-analyze",
        "oh-story-short-analyze",
        "oh-story-long-scan",
        "oh-story-short-scan",
        "oh-story-review",
        "oh-story-deslop",
    }
    oh_story_skills = {
        item["id"]: item
        for item in listed["skills"]
        if item["id"].startswith("oh-story-")
    }
    assert set(oh_story_skills) == expected_ids
    for item in oh_story_skills.values():
        assert item["layer"] == "builtin"
        assert item["source_format"] == "standard-skill-md"
        assert item["activation"] == "explicit"
        assert item["allow_tools"] == ["*"]

    baseline = {"get_status", "write_chapter"}
    automatic = resolver.resolve(agent="dante", base_tools=baseline)
    assert not expected_ids.intersection(item.id for item in automatic.skills)

    builtin_root = Path(__file__).parents[1] / "tools" / "runtime_skills"
    for skill_id in expected_ids:
        explicit = resolver.resolve(
            agent="dante",
            base_tools=baseline,
            explicit_skills=[skill_id],
        )
        assert set(explicit.allowed_tools) == baseline
        assert [skill.id for skill in explicit.skills] == [skill_id]
        skill = explicit.skills[0]
        assert skill.layer == "builtin"
        assert len(skill.references) == 1
        assert sum(len(item) for item in skill.references) <= skill.budget.max_reference_chars
        assert "oh-story-claudecode" in skill.instructions

        license_text = (builtin_root / skill_id / "LICENSE").read_text(encoding="utf-8")
        assert "Copyright (c) 2025-2026 oh-story-claudecode" in license_text


def test_skill_mentions_are_stable_and_do_not_match_email_addresses() -> None:
    assert extract_explicit_skill_mentions(
        "请用@scene-diagnosis 和 @dialogue，再用一次 @scene-diagnosis"
    ) == ("scene-diagnosis", "dialogue")
    assert extract_explicit_skill_mentions("writer@example.com") == ()


def test_goethe_and_dante_apply_standard_skill_for_one_turn(tmp_path: Path) -> None:
    init_project(tmp_path, "demo", "标准 Skill")
    _write_standard_skill(tmp_path / ".agents" / "skills", "scene-diagnosis")

    dante = DanteChatAgent(tmp_path, "demo")
    dante._active_user_instruction = "@scene-diagnosis 检查第一章"
    dante_tools, dante_prompt = dante._runtime_surface()
    assert dante_tools == {"get_status"}
    assert "scene-diagnosis@1.2.0" in dante_prompt
    dante._active_user_instruction = "普通讨论"
    default_tools, default_prompt = dante._runtime_surface()
    assert "get_context" in default_tools
    assert "scene-diagnosis@1.2.0" not in default_prompt

    goethe = GoetheChatAgent(tmp_path, "demo")
    goethe._active_user_instruction = "@scene-diagnosis 检查规划"
    goethe_tools, goethe_prompt = goethe._runtime_surface()
    assert goethe_tools == {"get_status"}
    assert "scene-diagnosis@1.2.0" in goethe_prompt


def test_global_and_project_layers_project_wins(tmp_path: Path) -> None:
    global_root = tmp_path / "global"
    project_root = tmp_path / "project"
    _write_skill(global_root, "layered", allow_tools=["get_status"])
    _write_skill(project_root / ".openwrite" / "skills", "layered", allow_tools=["list_chapters"])
    resolution = RuntimeSkillResolver(project_root, global_root=global_root).resolve(
        agent="dante", base_tools={"get_status", "list_chapters"}, explicit_skills=["layered"]
    )
    assert set(resolution.allowed_tools) == {"list_chapters"}
    assert resolution.skills[0].layer == "project"


def test_bad_manifest_and_dependency_are_diagnostics(tmp_path: Path) -> None:
    root = tmp_path / ".openwrite" / "skills"
    bad = root / "bad"
    bad.mkdir(parents=True)
    (bad / "manifest.yaml").write_text(
        "schema_version: 1\nid: bad\nunknown: true\n", encoding="utf-8"
    )
    _write_skill(root, "dependent", requires=["missing-skill"])
    resolution = RuntimeSkillResolver(tmp_path).resolve(
        agent="dante", base_tools={"get_status"}, explicit_skills=["dependent"]
    )
    assert any(item.code == "invalid_manifest" for item in resolution.diagnostics)
    assert any(item.code == "missing_dependency" for item in resolution.diagnostics)


def test_conflict_keeps_first_explicit_skill_and_reports_second(tmp_path: Path) -> None:
    root = tmp_path / ".openwrite" / "skills"
    _write_skill(root, "first", conflicts_with=["second"])
    _write_skill(root, "second")
    resolution = RuntimeSkillResolver(tmp_path).resolve(
        agent="dante", base_tools={"get_status"}, explicit_skills=["first", "second"]
    )
    assert [item.id for item in resolution.skills] == ["first"]
    assert any(item.code == "conflict" for item in resolution.diagnostics)


def test_rules_require_confirmation_and_reject_stale_preview(tmp_path: Path) -> None:
    rules = tmp_path / ".openwrite" / "rules"
    rules.mkdir(parents=True)
    (rules / "writing.md").write_text(
        "# mechanical\n- 每章必须有明确目标\n\n# semantic\n- 保留人物的犹豫感\n",
        encoding="utf-8",
    )
    compiler = RuleCompiler(tmp_path)
    preview = compiler.preview()
    assert preview.requires_confirmation
    assert "每章必须有明确目标" in preview.unified_diff
    with pytest.raises(RuntimeSkillError) as error:
        compiler.apply(preview.preview_id)
    assert error.value.code == "CONFIRMATION_REQUIRED"
    applied = compiler.apply(preview.preview_id, confirm=True)
    assert applied.revision == preview.compiled.revision
    assert compiler.active() == applied

    preview2 = compiler.preview()
    (rules / "writing.md").write_text("# mechanical\n- 变化后的规则\n", encoding="utf-8")
    with pytest.raises(RuntimeSkillError) as error:
        compiler.apply(preview2.preview_id, confirm=True)
    assert error.value.code == "STALE_PREVIEW"


def test_rule_compiled_artifact_is_strict_json(tmp_path: Path) -> None:
    rules = tmp_path / ".openwrite" / "rules"
    rules.mkdir(parents=True)
    (rules / "a.md").write_text("@mechanical: 不改写已确认事实\n", encoding="utf-8")
    compiler = RuleCompiler(tmp_path)
    compiler.apply(compiler.preview().preview_id, confirm=True)
    raw = json.loads((tmp_path / ".openwrite" / "compiled-rules.json").read_text(encoding="utf-8"))
    assert raw["mechanical_constraints"][0]["text"] == "不改写已确认事实"


def test_studio_exposes_same_runtime_resolution_and_rule_preview(tmp_path: Path) -> None:
    init_project(tmp_path, "demo", "Runtime Skill 测试")
    app = StudioApplication(tmp_path)
    operations = app.operation_status()
    assert operations["runtime_skills"]["skills"]
    listed = operations["runtime_skills"]["skills"][0]
    assert "description" in listed
    assert "requires" in listed
    assert listed["budget"]["max_tool_calls"] > 0
    resolved = app.runtime_skill_action(
        {"action": "resolve", "agent": "dante", "task": "chapter.write"}
    )
    assert resolved["allowed_tools"]
    preview = app.rule_action({"action": "preview"})
    assert preview["requires_confirmation"] is True
    applied = app.rule_action(
        {"action": "apply", "preview_id": preview["preview_id"], "confirm": True}
    )
    assert applied["revision"] == preview["compiled"]["revision"]
