"""Outline routes."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_project_root, get_tool_executor_service
from server.models.requests import CreateOutlineRequest
from server.models.responses import OutlineResponse
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["outline"])

_outline_locks: dict[str, asyncio.Lock] = {}


def _get_outline_lock(novel_id: str) -> asyncio.Lock:
    if novel_id not in _outline_locks:
        _outline_locks[novel_id] = asyncio.Lock()
    return _outline_locks[novel_id]


def _get_novel_dir(project_root: Path, novel_id: str) -> Path:
    d = project_root / "data" / "novels" / novel_id
    if not d.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")
    return d


@router.get("/novels/{novel_id}/outline", response_model=OutlineResponse)
async def get_outline(novel_id: str, project_root: Path = Depends(get_project_root)):
    novel_dir = _get_novel_dir(project_root, novel_id)
    outline_path = novel_dir / "src" / "outline.md"
    content = outline_path.read_text(encoding="utf-8") if outline_path.exists() else ""

    hierarchy = None
    hierarchy_path = novel_dir / "data" / "hierarchy.yaml"
    if hierarchy_path.exists():
        import yaml

        hierarchy = yaml.safe_load(hierarchy_path.read_text(encoding="utf-8"))

    return OutlineResponse(content=content, hierarchy=hierarchy)


@router.put("/novels/{novel_id}/outline", response_model=OutlineResponse)
async def update_outline(
    novel_id: str,
    req: CreateOutlineRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    async with _get_outline_lock(novel_id):
        result = await service.execute("create_outline", {"novel_id": novel_id, "outline_content": req.content})
        if "error" in result:
            raise HTTPException(500, result["error"])
    return OutlineResponse(content=req.content)


@router.get("/novels/{novel_id}/outline/hierarchy")
async def get_outline_hierarchy(novel_id: str, project_root: Path = Depends(get_project_root)):
    novel_dir = _get_novel_dir(project_root, novel_id)
    hierarchy_path = novel_dir / "data" / "hierarchy.yaml"
    if not hierarchy_path.exists():
        return {"hierarchy": None}
    import yaml

    return {"hierarchy": yaml.safe_load(hierarchy_path.read_text(encoding="utf-8"))}
