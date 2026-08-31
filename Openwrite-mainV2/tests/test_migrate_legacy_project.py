from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from models.foreshadowing import ForeshadowingGraph

from tools.migrate_legacy_project import (
    MigrationError,
    build_migration_manifest,
    migrate_legacy_project,
    validate_migrated_project,
)


NOVEL_ID = "system_urban"


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _create_legacy_project(root: Path) -> Path:
    novel_root = root / "data" / "novels" / NOVEL_ID
    _write(
        novel_root / "novel_config.yaml",
        "novel_id: system_urban\n"
        "style_id: system_urban\n"
        "current_arc: arc_001\n"
        "current_chapter: ch_001\n",
    )
    _write(novel_root / "src" / "outline.md", "# Outline\n")
    _write(novel_root / "src" / "world" / "rules.md", "# Rules\n")
    _write(novel_root / "data" / "hierarchy.yaml", "root: system\n")
    _write(novel_root / "data" / "world" / "timeline.md", "# Timeline\n")
    _write(
        novel_root / "data" / "manuscript" / "arc_001" / "ch_001.md",
        "# 第一章\n正文一\n",
    )
    _write(
        novel_root / "data" / "manuscript" / "arc_001" / "ch_001.md.bak",
        "# 第一章备份\n",
    )
    _write(
        novel_root / "data" / "history" / "ch_001" / "v_0001.md",
        "# 第一章历史版本\n",
    )
    _write(
        novel_root / "data" / "snapshots" / "snapshot_1.json",
        json.dumps({"chapter": 1, "truth": {"world": "system"}}, ensure_ascii=False),
    )
    _write(
        novel_root / "data" / "foreshadowing" / "dag.yaml",
        "nodes:\n  - id: first_clue\n",
    )
    return root


def test_build_manifest_counts_real_chapters_and_preserves_backup_paths(tmp_path: Path):
    source = _create_legacy_project(tmp_path / "legacy")

    manifest = build_migration_manifest(
        source,
        tmp_path / "target",
        NOVEL_ID,
    )

    assert manifest["novel_id"] == NOVEL_ID
    assert manifest["counts"]["chapters"] == 1
    assert manifest["counts"]["backups"] == 1
    assert manifest["counts"]["history_files"] == 1
    assert manifest["counts"]["snapshots"] == 1
    assert manifest["counts"]["foreshadowing_files"] == 1
    assert manifest["counts"]["world_files"] == 1
    assert manifest["counts"]["hierarchy_files"] == 1
    assert "data/manuscript/arc_001/ch_001.md.bak" in {
        item["source_relative"] for item in manifest["files"]
    }


def test_dry_run_creates_no_target_assets(tmp_path: Path):
    source = _create_legacy_project(tmp_path / "legacy")
    target = tmp_path / "target"

    result = migrate_legacy_project(source, target, NOVEL_ID, dry_run=True)

    assert result["dry_run"] is True
    assert result["manifest"]["counts"]["chapters"] == 1
    assert not (target / "data" / "novels" / NOVEL_ID).exists()
    assert not (target / "novel_config.yaml").exists()


def test_migration_copies_assets_writes_v2_config_and_manifest(tmp_path: Path):
    source = _create_legacy_project(tmp_path / "legacy")
    target = tmp_path / "target"

    result = migrate_legacy_project(source, target, NOVEL_ID)
    target_novel = target / "data" / "novels" / NOVEL_ID

    assert result["dry_run"] is False
    assert (target_novel / "src" / "outline.md").read_text(encoding="utf-8") == "# Outline\n"
    assert (
        target_novel / "data" / "manuscript" / "arc_001" / "ch_001.md.bak"
    ).exists()
    assert (target_novel / "data" / "history" / "ch_001" / "v_0001.md").exists()
    assert (target_novel / "data" / "snapshots" / "snapshot_1.json").exists()
    assert (target_novel / "data" / "foreshadowing" / "dag.yaml").exists()
    assert (target_novel / "data" / "migration" / "migration_manifest.json").exists()

    config = yaml.safe_load((target / "novel_config.yaml").read_text(encoding="utf-8"))
    assert config == {
        "novel_id": NOVEL_ID,
        "style_id": NOVEL_ID,
        "current_arc": "arc_001",
        "current_chapter": "ch_001",
    }

    validation = validate_migrated_project(target, NOVEL_ID)
    assert validation["ok"] is True
    assert validation["counts"]["chapters"] == 1
    assert validation["counts"]["backups"] == 1
    assert validation["missing"] == []


def test_migration_normalizes_legacy_foreshadowing_nodes_for_v2(tmp_path: Path):
    source = _create_legacy_project(tmp_path / "legacy")
    dag_path = (
        source
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "foreshadowing"
        / "dag.yaml"
    )
    _write(dag_path, "nodes: []\nedges: []\n")
    target = tmp_path / "target"

    migrate_legacy_project(source, target, NOVEL_ID)

    dag = yaml.safe_load(
        (
            target
            / "data"
            / "novels"
            / NOVEL_ID
            / "data"
            / "foreshadowing"
            / "dag.yaml"
        ).read_text(encoding="utf-8")
    )
    assert dag["nodes"] == {}
    assert ForeshadowingGraph.model_validate(dag).nodes == {}
    validation = validate_migrated_project(target, NOVEL_ID)
    assert validation["ok"] is True


def test_migration_prepares_runtime_truth_and_records_projection_hashes(
    tmp_path: Path,
):
    source = _create_legacy_project(tmp_path / "legacy")
    source_world = source / "data" / "novels" / NOVEL_ID / "data" / "world"
    _write(source_world / "current_state.md", "# 当前状态\n旧版状态\n")
    _write(source_world / "ledger.md", "# 账本\n旧版账本\n")
    _write(source_world / "relationships.md", "# 关系\n旧版关系\n")
    target = tmp_path / "target"

    migrate_legacy_project(source, target, NOVEL_ID)

    target_world = target / "data" / "novels" / NOVEL_ID / "data" / "world"
    assert (target_world / "runtime_state.json").exists()
    manifest = json.loads(
        (
            target_world.parent / "migration" / "migration_manifest.json"
        ).read_text(encoding="utf-8")
    )
    projected = {
        item["source_relative"]: item
        for item in manifest["files"]
        if item["source_relative"].startswith("data/world/")
    }
    assert all(
        projected[f"data/world/{name}"].get("target_sha256")
        for name in ("current_state.md", "ledger.md", "relationships.md")
    )
    validation = validate_migrated_project(target, NOVEL_ID)
    assert validation["ok"] is True


def test_validation_accepts_normalized_current_chapter_config(tmp_path: Path):
    source = _create_legacy_project(tmp_path / "legacy")
    _write(
        source
        / "data"
        / "novels"
        / NOVEL_ID
        / "data"
        / "manuscript"
        / "arc_001"
        / "ch_002.md",
        "# 第二章\n正文二\n",
    )
    target = tmp_path / "target"

    migrate_legacy_project(source, target, NOVEL_ID)

    config = yaml.safe_load((target / "novel_config.yaml").read_text(encoding="utf-8"))
    assert config["current_chapter"] == "ch_002"
    validation = validate_migrated_project(target, NOVEL_ID)
    assert validation["ok"] is True


def test_migration_refuses_nonempty_target_novel_without_overwriting(tmp_path: Path):
    source = _create_legacy_project(tmp_path / "legacy")
    target = tmp_path / "target"
    target_novel = target / "data" / "novels" / NOVEL_ID
    _write(target_novel / "src" / "existing.md", "keep me\n")

    with pytest.raises(MigrationError, match="TARGET_NOVEL_NOT_EMPTY"):
        migrate_legacy_project(source, target, NOVEL_ID)

    assert (target_novel / "src" / "existing.md").read_text(encoding="utf-8") == "keep me\n"
