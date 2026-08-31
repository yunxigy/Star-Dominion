from __future__ import annotations

import base64
import json
import zipfile
from pathlib import Path
from threading import Thread
from urllib.request import ProxyHandler, Request, build_opener

import pytest

from tools.asset_package import AssetPackageService
from tools.init_project import init_project
from tools.studio import StudioApplication, create_server
from tools.studio_contracts import StudioError


def _post(opener, url: str, payload: dict) -> dict:
    request = Request(
        url,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-OpenWrite-Studio": "1"},
    )
    with opener.open(request) as response:
        return json.loads(response.read())


def test_studio_id_patterns_escape_hyphens_for_browser_v_mode():
    index_path = Path(__file__).parents[1] / "tools" / "studio_assets" / "index.html"
    html = index_path.read_text(encoding="utf-8")

    assert 'pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,47}"' in html
    assert 'pattern="[A-Za-z0-9][A-Za-z0-9_\\-]+"' in html
    assert 'pattern="[A-Za-z0-9][A-Za-z0-9_-]' not in html


def test_studio_assets_are_mountable_under_openwrite_proxy_prefix():
    assets = Path(__file__).parents[1] / "tools" / "studio_assets"
    html = (assets / "index.html").read_text(encoding="utf-8")
    app = (assets / "app.js").read_text(encoding="utf-8")
    core = (assets / "js" / "core.js").read_text(encoding="utf-8")
    application = (assets / "js" / "application.js").read_text(encoding="utf-8")

    assert 'href="./styles.css' in html
    assert 'src="./app.js' in html
    assert 'import "./js/application.js' in app
    assert "export function studioPath" in core
    assert "fetch(studioPath(path)" in core
    assert "studioPath(`/api/export" in application


def test_studio_checkboxes_are_not_stretched_by_dialog_input_styles():
    styles_path = Path(__file__).parents[1] / "tools" / "studio_assets" / "styles.css"
    styles = styles_path.read_text(encoding="utf-8")

    assert '.write-dialog input:not([type="checkbox"]),' in styles
    assert '.write-dialog input:not([type="checkbox"]) {' in styles
    assert ".write-dialog input {" not in styles
    checkbox_rule = styles.split('input[type="checkbox"] {', maxsplit=1)[1].split(
        "}", maxsplit=1
    )[0]
    assert "width: 16px;" in checkbox_rule
    assert "height: 16px;" in checkbox_rule
    assert "padding: 0;" in checkbox_rule


def test_project_dialog_has_visible_close_control_and_handler():
    assets = Path(__file__).parents[1] / "tools" / "studio_assets"
    html = (assets / "index.html").read_text(encoding="utf-8")
    application = (assets / "js" / "application.js").read_text(encoding="utf-8")

    project_dialog = html.split('<dialog id="project-dialog"', 1)[1].split(
        "</dialog>", 1
    )[0]
    assert 'id="project-dialog-close"' in project_dialog
    assert 'aria-label="关闭作品选择"' in project_dialog
    assert "function closeProjectDialog()" in application
    assert "if (!state.workspace?.initialized) return;" in application
    assert '$("#project-dialog-close").addEventListener("click", closeProjectDialog);' in application


def test_studio_structured_assets_support_fields_and_validated_raw_mode(tmp_path: Path):
    init_project(tmp_path, "demo")
    app = StudioApplication(tmp_path)
    try:
        created = app.create_asset(
            {
                "kind": "character",
                "id": "char_linzhou",
                "data": {
                    "name": "林舟",
                    "summary": "钟楼修复师",
                    "aliases": ["小林"],
                    "tags": ["修复师", "钟楼"],
                },
                "body_markdown": "# 林舟\n\n他负责修复旧钟。\n",
            }
        )["asset"]
        assert created["data"]["aliases"] == ["小林"]
        assert 'id = "char_linzhou"' in created["raw_text"]
        summary = app.asset_surface("character")["assets"][0]
        assert summary["aliases"] == ["小林"]
        assert summary["tags"] == ["修复师", "钟楼"]

        raw_text = created["raw_text"].replace("钟楼修复师", "失去一分钟的人")
        updated = app.update_asset(
            {
                "kind": "character",
                "id": "char_linzhou",
                "revision": created["revision"],
                "raw_text": raw_text,
            }
        )["asset"]
        assert updated["data"]["summary"] == "失去一分钟的人"

        with pytest.raises(StudioError) as conflict:
            app.update_asset(
                {
                    "kind": "character",
                    "id": "char_linzhou",
                    "revision": created["revision"],
                    "data": {"goal": "覆盖新版本"},
                }
            )
        assert conflict.value.code == "ASSET_CONFLICT"
    finally:
        if app._task_runner is not None:
            app._task_runner.shutdown(wait=True)


def test_studio_structured_assets_preserve_legacy_markdown_titles(tmp_path: Path):
    init_project(tmp_path, "demo")
    path = tmp_path / "data" / "novels" / "demo" / "src" / "characters" / "lin_zhou.md"
    path.write_text("# 林舟\n\n## 性格\n\n沉默谨慎。\n", encoding="utf-8")
    app = StudioApplication(tmp_path)
    try:
        asset = app.read_asset("character", "lin_zhou")

        assert asset["name"] == "林舟"
        assert asset["data"]["name"] == "林舟"
        assert app.asset_surface("character")["assets"][0]["name"] == "林舟"
    finally:
        if app._task_runner is not None:
            app._task_runner.shutdown(wait=True)


def test_studio_asset_api_exposes_inline_registered_relations(tmp_path: Path):
    init_project(tmp_path, "demo")
    app = StudioApplication(tmp_path)
    try:
        app.create_asset(
            {
                "kind": "character",
                "id": "partner",
                "data": {"name": "苏遥"},
                "body_markdown": "# 苏遥\n",
            }
        )
        hero = app.create_asset(
            {
                "kind": "character",
                "id": "hero",
                "data": {"name": "林舟"},
                "body_markdown": "# 林舟\n\n//**林舟~>苏遥:共同调查旧案**\n",
            }
        )["asset"]

        assert hero["relation_view"]["counts"] == {
            "confirmed": 0,
            "registered": 1,
            "suggested": 0,
            "incoming": 0,
        }
        assert hero["relation_view"]["registered"][0]["target"] == "partner"
        assert app.read_asset("character", "partner")["relation_view"]["incoming"][0][
            "target"
        ] == "hero"

        confirmed = app.update_asset(
            {
                "kind": "character",
                "id": "hero",
                "revision": hero["revision"],
                "data": {
                    "related": [
                        {"target": "partner", "kind": "ally", "note": "共同调查旧案"}
                    ]
                },
                "body_markdown": hero["body_markdown"],
            }
        )["asset"]

        assert confirmed["relation_view"]["counts"]["confirmed"] == 1
        assert confirmed["relation_view"]["counts"]["registered"] == 0
    finally:
        if app._task_runner is not None:
            app._task_runner.shutdown(wait=True)


def test_studio_structured_assets_read_and_update_nested_world_files_in_place(
    tmp_path: Path,
):
    init_project(tmp_path, "demo")
    nested = (
        tmp_path
        / "data"
        / "novels"
        / "demo"
        / "src"
        / "world"
        / "entities"
        / "antagonists"
        / "chaos_beast.md"
    )
    nested.parent.mkdir(parents=True)
    nested.write_text(
        '+++\nid = "chaos_beast"\nname = "乱律者"\nkind = "threat"\n'
        'summary = "让规则失效"\n+++\n\n# 乱律者\n\n旧版本。\n',
        encoding="utf-8",
    )
    app = StudioApplication(tmp_path)
    try:
        listed = app.asset_surface("world")["assets"]
        summary = next(item for item in listed if item["id"] == "chaos_beast")
        loaded = app.read_asset("world", "chaos_beast")
        updated = app.update_asset(
            {
                "kind": "world",
                "id": "chaos_beast",
                "revision": loaded["revision"],
                "data": {"summary": "让一切规则自相矛盾"},
            }
        )["asset"]

        assert summary["path"].endswith("antagonists/chaos_beast.md")
        assert loaded["path"] == summary["path"]
        assert updated["path"] == summary["path"]
        assert updated["data"]["summary"] == "让一切规则自相矛盾"
        assert 'summary = "让一切规则自相矛盾"' in nested.read_text(encoding="utf-8")
        assert not (nested.parent.parent / "chaos_beast.md").exists()
    finally:
        if app._task_runner is not None:
            app._task_runner.shutdown(wait=True)


def test_studio_asset_package_preview_requires_explicit_conflict_resolution(tmp_path: Path):
    source_root = tmp_path / "source"
    target_root = tmp_path / "target"
    init_project(source_root, "source")
    source = StudioApplication(source_root)
    try:
        source.create_asset(
            {
                "kind": "world",
                "id": "org_clockkeepers",
                "data": {
                    "name": "守钟人",
                    "kind": "organization",
                    "summary": "维护钟塔秩序",
                },
            }
        )
        package_path = tmp_path / "assets.owasset.zip"
        AssetPackageService(source_root, "source").export(package_path)
    finally:
        if source._task_runner is not None:
            source._task_runner.shutdown(wait=True)

    init_project(target_root, "target")
    target = StudioApplication(target_root)
    try:
        target.create_asset(
            {
                "kind": "world",
                "id": "org_clockkeepers",
                "data": {"name": "旧守钟人", "kind": "organization"},
            }
        )
        preview = target.asset_package_preview(
            {"package_base64": base64.b64encode(package_path.read_bytes()).decode("ascii")}
        )
        assert preview["counts"] == {"new": 0, "conflict": 1}
        assert preview["assets"][0]["diff"]

        skipped = target.import_asset_package(
            {
                "upload_id": preview["upload_id"],
                "package_sha256": preview["package_sha256"],
            }
        )
        assert skipped["skipped"] == ["org_clockkeepers"]
        assert target.read_asset("world", "org_clockkeepers")["name"] == "旧守钟人"

        preview = target.asset_package_preview(
            {"package_base64": base64.b64encode(package_path.read_bytes()).decode("ascii")}
        )

        imported = target.import_asset_package(
            {
                "upload_id": preview["upload_id"],
                "package_sha256": preview["package_sha256"],
                "resolutions": {
                    "org_clockkeepers": {
                        "action": "rename",
                        "new_id": "org_clockkeepers_imported",
                    }
                },
            }
        )
        assert imported["id_map"] == {
            "org_clockkeepers": "org_clockkeepers_imported"
        }
        assert target.read_asset("world", "org_clockkeepers_imported")["name"] == "守钟人"
    finally:
        if target._task_runner is not None:
            target._task_runner.shutdown(wait=True)


def test_studio_asset_http_api_and_download_share_one_contract(tmp_path: Path):
    init_project(tmp_path, "demo")
    server = create_server(tmp_path, port=0)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    opener = build_opener(ProxyHandler({}))
    try:
        created = _post(
            opener,
            f"{base}/api/assets",
            {
                "kind": "progression",
                "id": "clock_sense",
                "data": {
                    "name": "听钟能力",
                    "kind": "ability",
                    "stages": [{"id": "latent", "name": "潜伏"}],
                },
            },
        )
        assert created["ok"] is True
        assert created["data"]["asset"]["id"] == "clock_sense"

        with opener.open(f"{base}/api/assets?kind=progression") as response:
            listed = json.loads(response.read())
        assert listed["data"]["assets"][0]["id"] == "clock_sense"

        with opener.open(
            f"{base}/api/assets/progression/clock_sense"
        ) as response:
            loaded = json.loads(response.read())
        assert loaded["data"]["data"]["stages"][0]["id"] == "latent"

        with opener.open(
            f"{base}/api/assets/package/export?select=progression%3Aclock_sense"
        ) as response:
            package = response.read()
            assert response.headers["Content-Type"] == "application/zip"
        package_path = tmp_path / "downloaded.owasset.zip"
        package_path.write_bytes(package)
        with zipfile.ZipFile(package_path) as archive:
            names = set(archive.namelist())
        assert "assets/progression/clock_sense.yaml" in names
        assert not any(name.startswith("data/") or "manuscript" in name for name in names)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
