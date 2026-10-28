"""Validate standalone toolbox paths and optional local workspace preservation."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
PLATFORM = ROOT / "平台管理"
WORKSPACE = ROOT.parent
MODULES = {"工具箱", "STM32上位机", "股票", "OpenWrite", "AI陪伴", "登录"}


def check_manifest(path: Path) -> int:
    manifest = json.loads(path.read_text(encoding="utf-8-sig"))
    base = (path.parent / manifest.get("workspace_root", "../..")).resolve()
    ports = []
    for service in manifest["services"]:
        directory = (base / service["working_directory"]).resolve()
        assert directory.is_relative_to(base) and directory.is_dir(), service["name"]
        arguments = service["arguments"]
        if arguments[0] == "-m":
            module = arguments[2].split(":", 1)[0] if arguments[1] == "uvicorn" else arguments[1]
            assert (directory / module.replace(".", "/")).with_suffix(".py").is_file(), module
        elif service["executable"] == "python":
            assert (directory / arguments[0]).is_file(), service["name"]
        else:
            assert (directory / "package.json").is_file(), service["name"]
        ports.extend(service["ports"])
    expected = list(range(8000, 8015)) if path.name.endswith("private.json") else [8005, 8009, 8010, 8011, 8012, 8013]
    assert sorted(ports) == expected, ports
    return len(manifest["services"])


def check_ignored(repository: Path, paths: list[str]) -> None:
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-z", "--stdin"], cwd=repository,
        input=("\0".join(paths) + "\0").encode(), capture_output=True,
    )
    assert result.returncode in (0, 1), "Git ignore check failed"
    ignored = set(result.stdout.decode("utf-8").strip("\0").split("\0"))
    assert ignored == set(paths), f"Missing ignore protection: {set(paths) - ignored}"


def main() -> None:
    assert (ROOT / "SD/package.json").is_file()
    assert (ROOT / "README.md").is_file()
    count = check_manifest(PLATFORM / "scripts/local-services.json")
    check_ignored(ROOT, ["平台管理/.env.local", "平台管理/.runtime/migration/six-module-migration.json",
                         "SD/node_modules/.package-lock.json", "research-reports/data/reports.db",
                         "平台管理/scripts/local-services.private.json"])
    private = PLATFORM / "scripts/local-services.private.json"
    if private.exists():
        check_manifest(private)
    if all((WORKSPACE / name).is_dir() for name in MODULES):
        directories = {path.name for path in WORKSPACE.iterdir() if path.is_dir()}
        assert directories == MODULES, f"Unexpected workspace directories: {directories ^ MODULES}"
        for name in ["AI陪伴", "股票", "STM32上位机"]:
            check_ignored(WORKSPACE / name, [".env.local", "data/private.db", "frontend/node_modules/.package-lock.json"]
                          if name != "STM32上位机" else [".env.local", "4G/gnss_runtime/1.json", "backend/data/sessions.json"])
        snapshot_path = PLATFORM / ".runtime/migration/six-module-migration.json"
        if snapshot_path.exists():
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
            missing = [old for old, record in snapshot["files"].items() if not (WORKSPACE / record["new"]).is_file()]
            assert not missing, f"Missing preserved files: {missing[:10]}"
            records = {old: record for old, record in snapshot["files"].items()
                       if ("/data/" in old or old.startswith("OpenWriteNovels/"))
                       and not old.endswith("novel_config.yaml")}
            for old, record in records.items():
                with (WORKSPACE / record["new"]).open("rb") as handle:
                    assert hashlib.file_digest(handle, "sha256").hexdigest() == record["sha256"], old
            print(f"PRESERVED: {len(snapshot['files'])} files; {len(records)} data/novel hashes match")
    print(f"PASS: flat toolbox root; {count} public services; local private manifest checked when present")


if __name__ == "__main__":
    main()
