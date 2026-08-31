"""Migrate legacy OpenWrite novel assets into the 5.8 project layout.

The migration is intentionally asset-focused. It does not copy the legacy
server, frontend, or writer runtime, and it never edits the source project.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import yaml


_NOVEL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
_CHAPTER_PATTERN = re.compile(r"^ch_(\d+)\.md$")


class MigrationError(RuntimeError):
    """A deterministic, user-facing migration failure."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(f"{code}: {message}")


def _validate_novel_id(novel_id: str) -> str:
    value = str(novel_id or "").strip()
    if not _NOVEL_ID_PATTERN.fullmatch(value):
        raise MigrationError("INVALID_NOVEL_ID", f"invalid novel id: {novel_id!r}")
    return value


def _project_root(value: Path | str) -> Path:
    return Path(value).expanduser().resolve()


def _novel_root(project_root: Path, novel_id: str) -> Path:
    root = project_root / "data" / "novels" / novel_id
    try:
        root.relative_to(project_root)
    except ValueError as exc:
        raise MigrationError("PATH_OUTSIDE_PROJECT", str(root)) from exc
    return root


def _iter_files(root: Path) -> Iterable[tuple[Path, str]]:
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.is_symlink():
            raise MigrationError("SYMLINK_NOT_ALLOWED", str(path))
        yield path, path.relative_to(root).as_posix()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _normalized_asset_bytes(source_path: Path, relative: str) -> bytes | None:
    """Return a V2-compatible representation for known legacy assets.

    OpenWrite 5.4 wrote an empty foreshadowing node collection as ``[]``;
    V2's model uses a mapping keyed by node ID.  Only this unambiguous shape
    conversion is performed, and only in the copied target asset.  Invalid or
    unknown files remain byte-for-byte copies so migration never discards
    user-authored data.
    """

    if relative.replace("\\", "/") != "data/foreshadowing/dag.yaml":
        return None
    try:
        raw = source_path.read_bytes()
        data = yaml.safe_load(raw.decode("utf-8-sig")) or {}
    except (OSError, UnicodeDecodeError, yaml.YAMLError):
        return None
    if not isinstance(data, dict):
        return None

    normalized = dict(data)
    changed = False
    nodes = data.get("nodes")
    if isinstance(nodes, list):
        mapped_nodes: dict[str, Any] = {}
        valid_nodes = True
        for node in nodes:
            if not isinstance(node, dict):
                valid_nodes = False
                break
            node_id = str(node.get("id") or "").strip()
            if not node_id or node_id in mapped_nodes:
                valid_nodes = False
                break
            mapped_nodes[node_id] = node
        if valid_nodes:
            normalized["nodes"] = mapped_nodes
            changed = True

    status = data.get("status")
    if isinstance(status, list) and not status:
        normalized["status"] = {}
        changed = True

    if not changed:
        return None
    return yaml.safe_dump(
        normalized,
        allow_unicode=True,
        sort_keys=False,
    ).encode("utf-8")


def _load_yaml_mapping(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise MigrationError("INVALID_YAML", f"could not read {path}: {exc}") from exc
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise MigrationError("INVALID_CONFIG", f"expected a mapping in {path}")
    return dict(value)


def _chapter_number(relative_path: str) -> int | None:
    match = _CHAPTER_PATTERN.fullmatch(Path(relative_path).name)
    if not match:
        return None
    return int(match.group(1))


def _asset_counts(files: list[tuple[Path, str]]) -> dict[str, int]:
    counts = {
        "chapters": 0,
        "backups": 0,
        "history_files": 0,
        "snapshots": 0,
        "foreshadowing_files": 0,
        "world_files": 0,
        "hierarchy_files": 0,
    }
    for _, relative in files:
        normalized = relative.replace("\\", "/")
        if normalized.startswith("data/manuscript/"):
            if _chapter_number(normalized):
                counts["chapters"] += 1
            if normalized.endswith(".md.bak"):
                counts["backups"] += 1
        if normalized.startswith("data/history/"):
            counts["history_files"] += 1
        if normalized.startswith("data/snapshots/"):
            counts["snapshots"] += 1
        if normalized.startswith("data/foreshadowing/"):
            counts["foreshadowing_files"] += 1
        if normalized.startswith("data/world/") and Path(normalized).suffix.lower() == ".md":
            counts["world_files"] += 1
        if normalized == "data/hierarchy.yaml":
            counts["hierarchy_files"] += 1
    return counts


def _file_kind(relative: str) -> str:
    normalized = relative.replace("\\", "/")
    if normalized == "novel_config.yaml":
        return "config"
    if normalized.startswith("src/"):
        return "source"
    if normalized.startswith("data/manuscript/"):
        return "manuscript"
    if normalized.startswith("data/history/"):
        return "history"
    if normalized.startswith("data/snapshots/"):
        return "snapshot"
    if normalized.startswith("data/foreshadowing/"):
        return "foreshadowing"
    if normalized.startswith("data/world/"):
        return "world"
    if normalized == "data/hierarchy.yaml":
        return "hierarchy"
    return "asset"


def _source_files(source_novel: Path) -> list[tuple[Path, str]]:
    if not source_novel.is_dir():
        raise MigrationError("SOURCE_NOVEL_NOT_FOUND", str(source_novel))
    files = [
        (path, relative)
        for path, relative in _iter_files(source_novel)
        if relative != "novel_config.yaml"
    ]
    return files


def _highest_chapter(files: list[tuple[Path, str]]) -> int | None:
    numbers = [
        chapter
        for _, relative in files
        if (chapter := _chapter_number(relative)) is not None
    ]
    return max(numbers) if numbers else None


def build_migration_manifest(
    source_project: Path,
    target_project: Path,
    novel_id: str,
) -> dict[str, object]:
    """Build a read-only manifest for one legacy novel."""

    normalized_id = _validate_novel_id(novel_id)
    source_root = _project_root(source_project)
    target_root = _project_root(target_project)
    source_novel = _novel_root(source_root, normalized_id)
    source_files = _source_files(source_novel)
    source_config = source_novel / "novel_config.yaml"
    if source_config.is_file():
        source_files_with_config = [(source_config, "novel_config.yaml"), *source_files]
    else:
        source_files_with_config = source_files

    files: list[dict[str, object]] = []
    for path, relative in sorted(source_files_with_config, key=lambda item: item[1]):
        target_relative = (
            "novel_config.yaml"
            if relative == "novel_config.yaml"
            else f"data/novels/{normalized_id}/{relative}"
        )
        item: dict[str, object] = {
            "source_relative": relative,
            "target_relative": target_relative,
            "kind": _file_kind(relative),
            "size": path.stat().st_size,
            "sha256": _sha256(path),
        }
        normalized = _normalized_asset_bytes(path, relative)
        if normalized is not None:
            item["transformation"] = "legacy_foreshadowing_nodes_list_to_mapping"
            item["target_sha256"] = _sha256_bytes(normalized)
        files.append(item)

    return {
        "schema_version": 1,
        "novel_id": normalized_id,
        "source_project": str(source_root),
        "target_project": str(target_root),
        "source_novel": str(source_novel),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "highest_chapter": _highest_chapter(source_files),
        "counts": _asset_counts(source_files),
        "files": files,
    }


def _build_target_config(
    source_config: dict[str, Any],
    highest_chapter: int | None,
) -> dict[str, Any]:
    current_arc = str(source_config.get("current_arc") or "arc_001")
    current_chapter = (
        f"ch_{highest_chapter:03d}"
        if highest_chapter is not None
        else str(source_config.get("current_chapter") or "ch_001")
    )
    config: dict[str, Any] = dict(source_config)
    config.update(
        {
            "novel_id": str(source_config.get("novel_id") or ""),
            "style_id": str(source_config.get("style_id") or source_config.get("novel_id") or ""),
            "current_arc": current_arc,
            "current_chapter": current_chapter,
        }
    )
    return config


def _write_yaml_mapping(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(value, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def _target_config_conflict(target_config: Path, novel_id: str) -> None:
    if not target_config.is_file():
        return
    config = _load_yaml_mapping(target_config)
    configured_id = str(config.get("novel_id") or "").strip()
    if configured_id and configured_id != novel_id:
        raise MigrationError(
            "TARGET_CONFIG_CONFLICT",
            f"{target_config} belongs to {configured_id!r}, not {novel_id!r}",
        )


def _target_novel_is_available(target_novel: Path) -> None:
    if target_novel.exists():
        raise MigrationError(
            "TARGET_NOVEL_NOT_EMPTY",
            f"target novel path already exists: {target_novel}",
        )


def _copy_asset_files(
    source_files: list[tuple[Path, str]],
    staging_novel: Path,
) -> None:
    for source_path, relative in source_files:
        destination = staging_novel / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        normalized = _normalized_asset_bytes(source_path, relative)
        if normalized is None:
            shutil.copy2(source_path, destination)
        else:
            destination.write_bytes(normalized)


def _prepare_runtime_truth(staging_root: Path, novel_id: str) -> None:
    """Eagerly create V2 runtime projections when legacy truth docs exist."""

    world_dir = staging_root / "data" / "novels" / novel_id / "data" / "world"
    required = tuple(world_dir / name for name in ("current_state.md", "ledger.md", "relationships.md"))
    if not all(path.is_file() for path in required):
        return
    if (world_dir / "runtime_state.json").is_file():
        return

    from tools.truth_manager import TruthFilesManager

    TruthFilesManager(staging_root, novel_id).load_runtime_state()


def _record_target_hashes(manifest: dict[str, object], staging_root: Path) -> None:
    """Record target hashes for assets normalized during migration."""

    for item in manifest.get("files", []):
        if not isinstance(item, dict) or str(item.get("kind") or "") == "config":
            continue
        target_relative = str(item.get("target_relative") or "")
        source_hash = str(item.get("sha256") or "")
        target_path = staging_root / Path(target_relative)
        if not target_relative or not target_path.is_file() or not source_hash:
            continue
        target_hash = _sha256(target_path)
        if target_hash == source_hash:
            continue
        item["target_sha256"] = target_hash
        item.setdefault("transformation", "v2_runtime_normalization")


def migrate_legacy_project(
    source_project: Path,
    target_project: Path,
    novel_id: str,
    *,
    dry_run: bool = False,
) -> dict[str, object]:
    """Copy one legacy novel into a V2 project without overwriting assets."""

    normalized_id = _validate_novel_id(novel_id)
    source_root = _project_root(source_project)
    target_root = _project_root(target_project)
    source_novel = _novel_root(source_root, normalized_id)
    target_novel = _novel_root(target_root, normalized_id)
    manifest = build_migration_manifest(source_root, target_root, normalized_id)

    _target_novel_is_available(target_novel)
    target_config = target_root / "novel_config.yaml"
    _target_config_conflict(target_config, normalized_id)
    if dry_run:
        return {
            "dry_run": True,
            "manifest": manifest,
            "target_created": False,
        }

    source_files = _source_files(source_novel)
    source_config = _load_yaml_mapping(source_novel / "novel_config.yaml")
    if source_config and str(source_config.get("novel_id") or normalized_id) != normalized_id:
        raise MigrationError(
            "SOURCE_CONFIG_CONFLICT",
            f"source config does not belong to {normalized_id!r}",
        )

    staging_parent = target_root.parent
    staging_parent.mkdir(parents=True, exist_ok=True)
    staging_root = Path(
        tempfile.mkdtemp(
            prefix=f".openwrite-migration-{normalized_id}-{uuid.uuid4().hex[:8]}-",
            dir=staging_parent,
        )
    )
    moved_novel = False
    created_config = False
    try:
        staging_novel = staging_root / "data" / "novels" / normalized_id
        _copy_asset_files(source_files, staging_novel)
        _write_yaml_mapping(
            staging_root / "novel_config.yaml",
            _build_target_config(source_config, manifest["highest_chapter"]),
        )
        _prepare_runtime_truth(staging_root, normalized_id)
        _record_target_hashes(manifest, staging_root)
        manifest_path = staging_novel / "data" / "migration" / "migration_manifest.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        target_novel.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staging_novel), str(target_novel))
        moved_novel = True

        if not target_config.exists():
            shutil.move(str(staging_root / "novel_config.yaml"), str(target_config))
            created_config = True

        return {
            "dry_run": False,
            "manifest": manifest,
            "target_created": True,
            "target_novel": str(target_novel),
            "config_path": str(target_config),
            "manifest_path": str(
                target_novel / "data" / "migration" / "migration_manifest.json"
            ),
        }
    except Exception:
        if moved_novel and target_novel.exists():
            shutil.rmtree(target_novel)
        if created_config and target_config.exists():
            target_config.unlink()
        raise
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def _required_paths(target_novel: Path) -> list[str]:
    return [
        "src",
        "data/manuscript",
        "data/history",
        "data/snapshots",
        "data/world",
        "data/foreshadowing/dag.yaml",
        "data/hierarchy.yaml",
    ]


def validate_migrated_project(
    target_project: Path,
    novel_id: str,
) -> dict[str, object]:
    """Validate the canonical V2 paths and the recorded source hashes."""

    normalized_id = _validate_novel_id(novel_id)
    target_root = _project_root(target_project)
    target_novel = _novel_root(target_root, normalized_id)
    files = list(_iter_files(target_novel)) if target_novel.is_dir() else []
    counts = _asset_counts(files)
    missing: list[str] = []
    if not target_novel.is_dir():
        missing.append(f"data/novels/{normalized_id}")
    for relative in _required_paths(target_novel):
        if not (target_novel / relative).exists():
            missing.append(f"data/novels/{normalized_id}/{relative}")

    config_path = target_root / "novel_config.yaml"
    config = _load_yaml_mapping(config_path) if config_path.is_file() else {}
    if str(config.get("novel_id") or "").strip() != normalized_id:
        missing.append("novel_config.yaml")

    manifest_path = target_novel / "data" / "migration" / "migration_manifest.json"
    manifest: dict[str, Any] = {}
    if not manifest_path.is_file():
        missing.append(
            f"data/novels/{normalized_id}/data/migration/migration_manifest.json"
        )
    else:
        try:
            manifest_value = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            missing.append(
                f"invalid:data/novels/{normalized_id}/data/migration/migration_manifest.json"
            )
        else:
            if isinstance(manifest_value, dict):
                manifest = manifest_value
            else:
                missing.append("invalid:migration_manifest")

    hash_mismatches: list[str] = []
    for item in manifest.get("files", []):
        if not isinstance(item, dict):
            continue
        # The root config is deliberately normalized during migration: its
        # current_chapter advances to the highest copied manuscript chapter.
        # Validate its semantic novel_id above, while source hashes remain the
        # integrity check for copied assets.
        if str(item.get("kind") or "") == "config":
            continue
        target_relative = str(item.get("target_relative") or "")
        expected = str(item.get("target_sha256") or item.get("sha256") or "")
        if not target_relative or not expected:
            continue
        target_path = target_root / Path(target_relative)
        if not target_path.is_file():
            missing.append(target_relative)
        elif _sha256(target_path) != expected:
            hash_mismatches.append(target_relative)

    expected_counts = manifest.get("counts")
    if isinstance(expected_counts, dict):
        for key, expected_value in expected_counts.items():
            if counts.get(key) != expected_value:
                hash_mismatches.append(
                    f"count:{key}:{counts.get(key)}!={expected_value}"
                )

    return {
        "ok": not missing and not hash_mismatches,
        "novel_id": normalized_id,
        "target_novel": str(target_novel),
        "counts": counts,
        "missing": sorted(set(missing)),
        "hash_mismatches": sorted(set(hash_mismatches)),
        "manifest_path": str(manifest_path),
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Migrate a legacy OpenWrite novel into the 5.8 asset layout."
    )
    parser.add_argument("--source", required=True, help="legacy project root")
    parser.add_argument("--target", required=True, help="OpenWrite 5.8 project root")
    parser.add_argument("--novel-id", required=True, help="novel id to migrate")
    parser.add_argument("--dry-run", action="store_true", help="only build a manifest")
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="validate the target project without copying assets",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.validate_only:
            result = validate_migrated_project(
                Path(args.target),
                args.novel_id,
            )
        else:
            result = migrate_legacy_project(
                Path(args.source),
                Path(args.target),
                args.novel_id,
                dry_run=args.dry_run,
            )
    except MigrationError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
