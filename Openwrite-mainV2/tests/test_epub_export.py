from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from threading import Thread
from urllib.request import ProxyHandler, build_opener
from xml.etree import ElementTree

import pytest

import tools.cli as cli_module
from tools.cli import _save_chapter
from tools.epub_export import EpubExportError, export_epub, validate_epub
from tools.init_project import init_project
from tools.studio import create_server


def _book(tmp_path: Path) -> Path:
    init_project(tmp_path, "demo", "遗失的一分钟")
    _save_chapter(tmp_path, "demo", "ch_001", "第一章 雨夜", "林舟听见旧钟响了一声。")
    _save_chapter(tmp_path, "demo", "ch_002", "第二章 回声", "那一分钟仍不在任何记录里。")
    cover = tmp_path / "cover.png"
    cover.write_bytes(b"\x89PNG\r\n\x1a\n" + b"test-cover")
    return cover


def test_epub3_preserves_chinese_order_metadata_and_local_cover(tmp_path: Path) -> None:
    cover = _book(tmp_path)
    first_chapter = next(
        (tmp_path / "data" / "novels" / "demo" / "data" / "manuscript").rglob(
            "ch_001.md"
        )
    )
    first_chapter.write_text(
        first_chapter.read_text(encoding="utf-8")
        + "\n//**林舟[位置]：钟楼外 -> 钟楼内**\n",
        encoding="utf-8",
    )
    output = tmp_path / "book.epub"
    export_epub(
        tmp_path,
        "demo",
        output,
        title="遗失的一分钟",
        author="测试作者",
        cover=cover,
    )

    assert validate_epub(output) == {"valid": True, "chapters": 2, "files": 8}
    with zipfile.ZipFile(output) as archive:
        assert archive.namelist()[0] == "mimetype"
        assert archive.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
        package = archive.read("OEBPS/package.opf").decode("utf-8")
        nav = archive.read("OEBPS/nav.xhtml").decode("utf-8")
        first = archive.read("OEBPS/text/chapter-0001.xhtml").decode("utf-8")
        second = archive.read("OEBPS/text/chapter-0002.xhtml").decode("utf-8")
    assert "遗失的一分钟" in package and "测试作者" in package
    assert 'properties="cover-image"' in package
    assert nav.index("第一章 雨夜") < nav.index("第二章 回声")
    assert "林舟听见旧钟响了一声" in first
    assert "//**" not in first
    assert "那一分钟仍不在任何记录里" in second
    ElementTree.fromstring(first)
    ElementTree.fromstring(second)


def test_epub_rejects_external_cover_without_overwriting_output(tmp_path: Path) -> None:
    _book(tmp_path)
    external = tmp_path.parent / "outside-cover.png"
    external.write_bytes(b"\x89PNG\r\n\x1a\n")
    output = tmp_path / "book.epub"
    output.write_bytes(b"existing")

    with pytest.raises(EpubExportError, match="项目目录内"):
        export_epub(tmp_path, "demo", output, cover=external)
    assert output.read_bytes() == b"existing"


def test_epub_validation_rejects_archive_path_traversal(tmp_path: Path) -> None:
    path = tmp_path / "invalid.epub"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            zipfile.ZipInfo("mimetype"),
            "application/epub+zip",
            compress_type=zipfile.ZIP_STORED,
        )
        archive.writestr("META-INF/container.xml", "<container/>")
        archive.writestr("OEBPS/package.opf", "<package/>")
        archive.writestr("OEBPS/nav.xhtml", "<html/>")
        archive.writestr("../escape.txt", "blocked")
    with pytest.raises(EpubExportError, match="越界路径"):
        validate_epub(path)


def test_epub_cli_export_smoke(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _book(tmp_path)
    output = tmp_path / "cli.epub"
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "openwrite",
            "export",
            "--format",
            "epub",
            "--output",
            str(output),
            "--title",
            "CLI 书名",
            "--author",
            "CLI 作者",
        ],
    )
    assert cli_module.main() == 0
    assert validate_epub(output)["chapters"] == 2


def test_studio_epub_download_is_valid(tmp_path: Path) -> None:
    _book(tmp_path)
    server = create_server(tmp_path, port=0)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    opener = build_opener(ProxyHandler({}))
    output = tmp_path / "studio.epub"
    try:
        with opener.open(
            f"http://127.0.0.1:{server.server_port}/api/export?format=epub"
        ) as response:
            output.write_bytes(response.read())
            assert response.headers["Content-Type"] == "application/epub+zip"
        assert validate_epub(output)["chapters"] == 2
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
