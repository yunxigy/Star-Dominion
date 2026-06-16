"""Writing statistics routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_project_root

router = APIRouter(tags=["stats"])


@router.get("/novels/{novel_id}/stats")
async def get_writing_stats(
    novel_id: str,
    project_root: Path = Depends(get_project_root),
):
    """获取写作统计数据。"""
    from tools.writing_stats import get_writing_stats as _get_stats

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    try:
        stats = _get_stats(project_root, novel_id)
        return stats
    except Exception as e:
        raise HTTPException(500, f"Failed to get stats: {e}")
