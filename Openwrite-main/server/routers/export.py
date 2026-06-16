"""Export routes — epub and pdf download."""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from server.dependencies import get_project_root

router = APIRouter(tags=["export"])


@router.get("/novels/{novel_id}/export/epub")
async def export_epub(
    novel_id: str,
    project_root: Path = Depends(get_project_root),
    chapters: str = Query("", description="逗号分隔的章节 ID，为空则导出全部"),
):
    """导出小说为 EPUB 格式并下载。"""
    from tools.export import export_epub as _export_epub, _list_chapter_ids

    chapter_ids = None
    if chapters.strip():
        chapter_ids = [c.strip() for c in chapters.split(",") if c.strip()]

    # Validate novel exists
    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    try:
        output_path = _export_epub(project_root, novel_id, chapter_ids=chapter_ids)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")

    filename = f"{novel_id}.epub"
    return FileResponse(
        path=str(output_path),
        filename=filename,
        media_type="application/epub+zip",
        background=None,
    )


@router.get("/novels/{novel_id}/export/pdf")
async def export_pdf(
    novel_id: str,
    project_root: Path = Depends(get_project_root),
    chapters: str = Query("", description="逗号分隔的章节 ID，为空则导出全部"),
):
    """导出小说为 PDF 格式并下载。"""
    from tools.export import export_pdf as _export_pdf

    chapter_ids = None
    if chapters.strip():
        chapter_ids = [c.strip() for c in chapters.split(",") if c.strip()]

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    try:
        output_path = _export_pdf(project_root, novel_id, chapter_ids=chapter_ids)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")

    filename = f"{novel_id}.pdf"
    return FileResponse(
        path=str(output_path),
        filename=filename,
        media_type="application/pdf",
        background=None,
    )


@router.get("/novels/{novel_id}/export/chapters")
async def list_exportable_chapters(
    novel_id: str,
    project_root: Path = Depends(get_project_root),
):
    """列出可导出的章节。"""
    from tools.export import _list_chapter_ids, _load_chapter

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    chapter_ids = _list_chapter_ids(project_root, novel_id)
    chapters = []
    for cid in chapter_ids:
        title, content = _load_chapter(project_root, novel_id, cid)
        word_count = len(content) if content else 0
        chapters.append({
            "chapter_id": cid,
            "title": title or cid,
            "word_count": word_count,
        })

    return {"chapters": chapters, "total": len(chapters)}
