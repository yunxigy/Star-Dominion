"""Graph routes — character relationship visualization data."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_project_root

router = APIRouter(tags=["graph"])


@router.get("/novels/{novel_id}/graph/characters")
async def get_character_graph(
    novel_id: str,
    project_root: Path = Depends(get_project_root),
):
    """获取角色关系图数据。"""
    from tools.character_graph import build_character_graph

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    try:
        graph = build_character_graph(project_root, novel_id)
        return graph
    except Exception as e:
        raise HTTPException(500, f"Failed to build graph: {e}")
