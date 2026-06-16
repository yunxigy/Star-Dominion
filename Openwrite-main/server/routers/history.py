"""Chapter history routes — version snapshots and diff."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from server.dependencies import get_project_root

router = APIRouter(tags=["history"])


@router.get("/novels/{novel_id}/chapters/{chapter_id}/history")
async def list_chapter_history(
    novel_id: str,
    chapter_id: str,
    project_root: Path = Depends(get_project_root),
):
    """列出章节的版本历史。"""
    from tools.chapter_history import list_versions

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    versions = list_versions(project_root, novel_id, chapter_id)
    return {"chapter_id": chapter_id, "versions": versions, "total": len(versions)}


@router.get("/novels/{novel_id}/chapters/{chapter_id}/history/{version}")
async def get_version_content(
    novel_id: str,
    chapter_id: str,
    version: int,
    project_root: Path = Depends(get_project_root),
):
    """获取指定版本的内容。"""
    from tools.chapter_history import get_version_content as _get_content

    content = _get_content(project_root, novel_id, chapter_id, version)
    if content is None:
        raise HTTPException(404, f"Version {version} not found")
    return {"chapter_id": chapter_id, "version": version, "content": content}


@router.get("/novels/{novel_id}/chapters/{chapter_id}/diff")
async def diff_versions(
    novel_id: str,
    chapter_id: str,
    v1: int = Query(..., description="版本 A"),
    v2: int = Query(..., description="版本 B（0 = 当前）"),
    project_root: Path = Depends(get_project_root),
):
    """对比两个版本的差异。"""
    from tools.chapter_history import diff_versions as _diff, diff_with_current

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    try:
        if v2 == 0:
            result = diff_with_current(project_root, novel_id, chapter_id, v1)
        else:
            result = _diff(project_root, novel_id, chapter_id, v1, v2)
        return result
    except Exception as e:
        raise HTTPException(500, f"Diff failed: {e}")
