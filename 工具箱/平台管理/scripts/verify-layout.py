"""Validate the six-module layout without starting services or changing data."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[3]
PLATFORM = Path(__file__).resolve().parents[1]
MODULES = {"工具箱", "STM32上位机", "股票", "OpenWrite", "AI陪伴", "登录"}


def main() -> None:
    directories = {path.name for path in ROOT.iterdir() if path.is_dir() and path.name != ".git"}
    assert directories in (MODULES, {"工具箱"}), f"Unexpected top-level directories: {directories ^ MODULES}"
    manifest_path = PLATFORM / "scripts/local-services.private.json"
    if not manifest_path.exists():
        manifest_path = PLATFORM / "scripts/local-services.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    ports: list[int] = []
    for service in manifest["services"]:
        directory = (ROOT / service["working_directory"]).resolve()
        assert directory.is_relative_to(ROOT) and directory.is_dir(), service["name"]
        arguments = service["arguments"]
        if arguments[0] == "-m":
            module = arguments[2].split(":", 1)[0] if arguments[1] == "uvicorn" else arguments[1]
            assert (directory / module.replace(".", "/")).with_suffix(".py").exists(), module
        elif service["executable"] == "python":
            assert (directory / arguments[0]).is_file(), service["name"]
        else:
            assert (directory / "package.json").is_file(), service["name"]
        ports.extend(service["ports"])
    expected_ports = list(range(8000, 8015)) if manifest_path.name.endswith("private.json") else [8005, 8009, 8010, 8011, 8012, 8013]
    assert sorted(ports) == expected_ports, ports
    for module in directories:
        assert (ROOT / module / "README.md").is_file(), module
    for name in (".env.local.example", ".env.production.example", "nginx.conf"):
        assert (PLATFORM / name).is_file(), name

    sensitive_paths = [
        "登录/data/auth.db", "AI陪伴/守岸人3.0/data/config.yaml",
        "股票/stock-module/data/stock.db", "工具箱/平台管理/.env.local",
        "工具箱/平台管理/.runtime/migration/six-module-migration.json",
        "OpenWrite/Openwrite-mainV2/.env", "OpenWrite/Openwrite-mainV2/.venv/pyvenv.cfg",
        "OpenWrite/Openwrite-mainV2/.openwrite-runtime/windows-py3.11/pyvenv.cfg",
        "AI陪伴/SillyTavern/package.json", "工具箱/SD/node_modules/.package-lock.json",
        "STM32上位机/4G/gnss_runtime/1.json", "STM32上位机/wangye/4G/gnss_runtime/1.json",
    ]
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-z", "--stdin"], cwd=ROOT,
        input=("\0".join(sensitive_paths) + "\0").encode("utf-8"), capture_output=True,
    )
    assert result.returncode in (0, 1), result.stderr.decode("utf-8", errors="replace")
    ignored = set(result.stdout.decode("utf-8").strip("\0").split("\0"))
    assert ignored == set(sensitive_paths), f"Missing ignore protection: {set(sensitive_paths) - ignored}"

    snapshot_path = PLATFORM / ".runtime/migration/six-module-migration.json"
    if snapshot_path.exists():
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        missing = [old for old, record in snapshot["files"].items() if not (ROOT / record["new"]).is_file()]
        assert not missing, f"Files missing after migration: {missing}"
        data_files = {old: record for old, record in snapshot["files"].items()
                      if ("/data/" in old or old.startswith("OpenWriteNovels/"))
                      and not old.endswith("novel_config.yaml")}
        for old, record in data_files.items():
            with (ROOT / record["new"]).open("rb") as handle:
                actual_hash = hashlib.file_digest(handle, "sha256").hexdigest()
            assert actual_hash == record["sha256"], f"Runtime/novel content changed: {old}"
        print(f"PRESERVED: {len(snapshot['files'])} files present; {len(data_files)} data/novel hashes match")
    print(f"PASS: {len(directories)} modules; {len(manifest['services'])} service directories; {len(sensitive_paths)} ignore checks")


if __name__ == "__main__":
    main()
