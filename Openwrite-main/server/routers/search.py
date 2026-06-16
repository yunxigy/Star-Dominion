"""Search routes — global search across novel content."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from server.dependencies import get_project_root

router = APIRouter(tags=["search"])


@router.get("/novels/{novel_id}/search")
async def search_novel(
    novel_id: str,
    q: str = Query(..., min_length=1, description="搜索关键词"),
    project_root: Path = Depends(get_project_root),
    chapters: bool = Query(True, description="搜索章节"),
    characters: bool = Query(True, description="搜索角色"),
    outline: bool = Query(True, description="搜索大纲"),
    truth: bool = Query(True, description="搜索真相文件"),
    limit: int = Query(50, ge=1, le=200, description="最大结果数"),
):
    """全局搜索小说内容。"""
    from tools.search import global_search

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    results = global_search(
        project_root,
        novel_id,
        q,
        search_chapters=chapters,
        search_characters=characters,
        search_outline=outline,
        search_truth=truth,
        max_results=limit,
    )
    return results
