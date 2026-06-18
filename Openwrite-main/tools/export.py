"""小说导出工具 — 支持 EPUB 和 PDF 格式。"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path
from typing import Any


# ── 章节加载 ──────────────────────────────────────────────────

def _list_chapter_ids(project_root: Path, novel_id: str) -> list[str]:
    """列出所有章节 ID（ch_001, ch_002, ...），按编号排序。"""
    manuscript_dir = project_root / "data" / "novels" / novel_id / "data" / "manuscript"
    if not manuscript_dir.exists():
        return []
    pattern = re.compile(r"^ch_\d+$")
    ids = set()
    for p in manuscript_dir.rglob("*.md"):
        if p.is_file() and pattern.fullmatch(p.stem):
            ids.add(p.stem)
    return sorted(ids, key=lambda x: int(x.split("_")[-1]))


def _load_chapter(project_root: Path, novel_id: str, chapter_id: str) -> tuple[str, str]:
    """加载章节内容，返回 (title, content)。"""
    manuscript_dir = project_root / "data" / "novels" / novel_id / "data" / "manuscript"
    if not manuscript_dir.exists():
        return ("", "")

    # Try direct path first
    for p in sorted(manuscript_dir.rglob(f"**/{chapter_id}.md")):
        if p.is_file() and p.stem == chapter_id:
            text = p.read_text(encoding="utf-8")
            title = ""
            lines = text.split("\n")
            for line in lines:
                if line.startswith("# "):
                    title = line[2:].strip()
                    break
            return (title, text)

    return ("", "")


def _load_novel_meta(project_root: Path, novel_id: str) -> dict[str, Any]:
    """加载小说元信息。"""
    config_path = project_root / "novel_config.yaml"
    meta: dict[str, Any] = {"title": novel_id, "author": ""}
    if config_path.exists():
        import yaml
        cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        meta["title"] = cfg.get("title", novel_id)
        meta["author"] = cfg.get("author", "")
    return meta


# ── Markdown → HTML ──────────────────────────────────────────

def _md_to_html(md_text: str) -> str:
    """将 Markdown 转换为 HTML。"""
    import markdown
    # Remove the first # title line (we handle it separately)
    lines = md_text.split("\n")
    body_lines = []
    for line in lines:
        if line.startswith("# ") and not body_lines:
            continue  # skip first title
        body_lines.append(line)
    body = "\n".join(body_lines).strip()
    return markdown.markdown(body, extensions=["extra", "codehilite"])


def _md_to_plain_text(md_text: str) -> str:
    """将 Markdown 转换为纯文本（用于 PDF）。"""
    lines = md_text.split("\n")
    body_lines = []
    for line in lines:
        if line.startswith("# ") and not body_lines:
            continue
        # Strip markdown formatting
        line = re.sub(r"\*\*(.*?)\*\*", r"\1", line)  # bold
        line = re.sub(r"\*(.*?)\*", r"\1", line)  # italic
        line = re.sub(r"`(.*?)`", r"\1", line)  # code
        line = re.sub(r"!\[.*?\]\(.*?\)", "", line)  # images
        line = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", line)  # links
        body_lines.append(line)
    return "\n".join(body_lines).strip()


# ── EPUB 导出 ──────────────────────────────────────────────────

def export_epub(
    project_root: Path,
    novel_id: str,
    output_path: Path | None = None,
    chapter_ids: list[str] | None = None,
) -> Path:
    """导出小说为 EPUB 格式。

    Args:
        project_root: 项目根目录
        novel_id: 小说 ID
        output_path: 输出文件路径，为 None 时使用临时文件
        chapter_ids: 指定章节 ID 列表，为 None 时导出全部

    Returns:
        生成的 EPUB 文件路径
    """
    from ebooklib import epub

    meta = _load_novel_meta(project_root, novel_id)
    if chapter_ids is None:
        chapter_ids = _list_chapter_ids(project_root, novel_id)

    if not chapter_ids:
        raise ValueError("没有可导出的章节")

    book = epub.EpubBook()

    # 元信息
    book.set_identifier(f"openwrite-{novel_id}")
    book.set_title(meta["title"])
    book.set_language("zh")
    if meta.get("author"):
        book.add_author(meta["author"])

    # CSS 样式
    style = """
    body { font-family: "Noto Serif CJK SC", "Source Han Serif SC", "SimSun", serif; line-height: 1.8; margin: 1em; }
    h1 { text-align: center; margin: 2em 0 1em; font-size: 1.5em; }
    h2 { text-align: center; margin: 1.5em 0 0.8em; font-size: 1.2em; color: #555; }
    p { text-indent: 2em; margin: 0.5em 0; }
    .chapter-title { text-align: center; font-size: 1.8em; margin: 3em 0 2em; font-weight: bold; }
    """
    css = epub.EpubItem(
        uid="style",
        file_name="style/default.css",
        media_type="text/css",
        content=style.encode("utf-8"),
    )
    book.add_item(css)

    # 目录页
    toc_html = "<h1>目录</h1>\n<ul>\n"
    chapters: list[epub.EpubHtml] = []

    for cid in chapter_ids:
        title, content = _load_chapter(project_root, novel_id, cid)
        if not content:
            continue

        if not title:
            title = cid

        # 章节 HTML
        chapter_html = _md_to_html(content)
        full_html = f"""<html><head><link rel="stylesheet" href="style/default.css"/></head>
<body>
<div class="chapter-title">{title}</div>
{chapter_html}
</body></html>"""

        ch = epub.EpubHtml(
            title=title,
            file_name=f"{cid}.xhtml",
            lang="zh",
        )
        ch.content = full_html.encode("utf-8")
        ch.add_item(css)
        book.add_item(ch)
        chapters.append(ch)
        toc_html += f'<li><a href="{cid}.xhtml">{title}</a></li>\n'

    toc_html += "</ul>"

    # 目录页作为封面后第一页
    toc_page = epub.EpubHtml(
        title="目录",
        file_name="toc.xhtml",
        lang="zh",
    )
    toc_page.content = toc_html.encode("utf-8")
    toc_page.add_item(css)
    book.add_item(toc_page)

    # 目录和脊柱
    book.toc = [toc_page] + chapters
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", toc_page] + chapters

    # 输出
    if output_path is None:
        output_path = Path(tempfile.mktemp(suffix=".epub"))

    epub.write_epub(str(output_path), book)
    return output_path


# ── PDF 导出 ──────────────────────────────────────────────────

def export_pdf(
    project_root: Path,
    novel_id: str,
    output_path: Path | None = None,
    chapter_ids: list[str] | None = None,
) -> Path:
    """导出小说为 PDF 格式。

    Args:
        project_root: 项目根目录
        novel_id: 小说 ID
        output_path: 输出文件路径，为 None 时使用临时文件
        chapter_ids: 指定章节 ID 列表，为 None 时导出全部

    Returns:
        生成的 PDF 文件路径
    """
    from fpdf import FPDF

    meta = _load_novel_meta(project_root, novel_id)
    if chapter_ids is None:
        chapter_ids = _list_chapter_ids(project_root, novel_id)

    if not chapter_ids:
        raise ValueError("没有可导出的章节")

    # 查找中文字体
    font_path = _find_cjk_font()

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)

    if font_path:
        pdf.add_font("CJK", "", str(font_path), uni=True)
        pdf.add_font("CJK", "B", str(font_path), uni=True)
        font_name = "CJK"
    else:
        font_name = "Helvetica"

    # 封面
    pdf.add_page()
    pdf.set_font(font_name, "B", 28)
    pdf.ln(60)
    pdf.cell(0, 20, meta["title"], ln=True, align="C")
    if meta.get("author"):
        pdf.set_font(font_name, "", 16)
        pdf.ln(10)
        pdf.cell(0, 10, meta["author"], ln=True, align="C")

    # 目录页
    pdf.add_page()
    pdf.set_font(font_name, "B", 20)
    pdf.cell(0, 15, "目录", ln=True, align="C")
    pdf.ln(10)
    pdf.set_font(font_name, "", 12)

    chapter_titles: list[tuple[str, str]] = []
    for cid in chapter_ids:
        title, _ = _load_chapter(project_root, novel_id, cid)
        if not title:
            title = cid
        chapter_titles.append((cid, title))
        pdf.cell(0, 8, title, ln=True)

    # 各章节
    for cid, title in chapter_titles:
        _, content = _load_chapter(project_root, novel_id, cid)
        if not content:
            continue

        plain = _md_to_plain_text(content)

        pdf.add_page()
        pdf.set_font(font_name, "B", 20)
        pdf.ln(20)
        pdf.cell(0, 15, title, ln=True, align="C")
        pdf.ln(10)

        pdf.set_font(font_name, "", 12)
        for para in plain.split("\n"):
            para = para.strip()
            if not para:
                pdf.ln(5)
                continue
            pdf.multi_cell(0, 8, para)
            pdf.ln(2)

    # 输出
    if output_path is None:
        output_path = Path(tempfile.mktemp(suffix=".pdf"))

    pdf.output(str(output_path))
    return output_path


def _find_cjk_font() -> Path | None:
    """查找系统中的中文字体。"""
    import os

    candidates = [
        # Windows
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "msyh.ttc",
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "simsun.ttc",
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "simhei.ttf",
        # Linux
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"),
        # macOS
        Path("/System/Library/Fonts/PingFang.ttc"),
        Path("/System/Library/Fonts/STHeiti Light.ttc"),
    ]
    for p in candidates:
        if p.exists():
            return p
    return None
