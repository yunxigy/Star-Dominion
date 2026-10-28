from pathlib import Path
from zipfile import ZipFile

import pytest

from document_converter.converters import (
    ConversionError,
    SUPPORTED_TARGETS,
    convert_pdf_to_word_images,
    convert_html_to_docx,
    convert_markdown_to_docx,
    validate_input_for_target,
)


def test_supported_targets_include_all_confirmed_workflows():
    assert SUPPORTED_TARGETS == {
        "pdf-to-word-image",
        "office-to-pdf",
        "pdf-table-to-xlsx",
        "markdown-to-docx",
        "html-to-docx",
        "scan-to-docx",
    }


def test_validate_input_rejects_wrong_extension():
    with pytest.raises(ConversionError, match="不支持"):
        validate_input_for_target(Path("notes.txt"), "office-to-pdf")


def test_markdown_conversion_writes_structured_docx(tmp_path: Path):
    source = tmp_path / "note.md"
    output = tmp_path / "note.docx"
    source.write_text("# 标题\n\n这是正文。\n\n- 第一项\n- 第二项\n\n```python\nprint('ok')\n```", encoding="utf-8")

    convert_markdown_to_docx(source, output)

    assert output.exists()
    with ZipFile(output) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    assert "标题" in xml
    assert "这是正文" in xml
    assert "第一项" in xml
    assert "print('ok')" in xml


def test_html_conversion_rejects_script_and_keeps_table(tmp_path: Path):
    source = tmp_path / "page.html"
    output = tmp_path / "page.docx"
    source.write_text(
        "<html><body><h1>报告</h1><script>alert(1)</script>"
        "<p>摘要</p><table><tr><th>字段</th><th>值</th></tr>"
        "<tr><td>A</td><td>1</td></tr></table></body></html>",
        encoding="utf-8",
    )

    convert_html_to_docx(source, output)

    with ZipFile(output) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    assert "报告" in xml
    assert "摘要" in xml
    assert "字段" in xml and "1" in xml
    assert "alert" not in xml


def test_pdf_to_word_creates_output_directory_before_rendering(tmp_path: Path):
    import sys

    import document_converter.converters as converters

    class FakePixmap:
        def save(self, path: str) -> None:
            Path(path).write_bytes(b"page")

    class FakePage:
        rect = type("Rect", (), {"width": 612, "height": 792})()

        def get_pixmap(self, **_kwargs):
            return FakePixmap()

    class FakePdf:
        page_count = 1

        def __iter__(self):
            return iter([FakePage()])

        def close(self):
            return None

    class FakeDocument:
        sections = [type("Section", (), {})()]

        def add_picture(self, _path: str, width=None):
            return None

        def save(self, path: Path):
            Path(path).write_bytes(b"docx")

        def add_section(self, _section):
            section = type("Section", (), {})()
            self.sections.append(section)
            return section

    class FakeFitz:
        class Matrix:
            def __init__(self, *_args):
                pass

    source = tmp_path / "source.pdf"
    source.write_bytes(b"not parsed by fake PDF backend")
    output = tmp_path / "nested" / "source.docx"
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setitem(sys.modules, "fitz", FakeFitz)
    monkeypatch.setattr(converters, "_fitz_document", lambda _source: FakePdf())
    monkeypatch.setattr(converters, "Document", FakeDocument)
    try:
        converters.convert_pdf_to_word_images(source, output)
    finally:
        monkeypatch.undo()

    assert output.exists()


def test_libreoffice_can_use_explicit_binary_path(monkeypatch, tmp_path: Path):
    import document_converter.converters as converters

    binary = tmp_path / "soffice"
    binary.write_bytes(b"executable placeholder")
    monkeypatch.setenv("LIBREOFFICE_BIN", str(binary))
    monkeypatch.setattr(converters.shutil, "which", lambda _name: None)

    assert converters._soffice() == str(binary)
