"""Workflow routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_project_root, get_tool_executor_service
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["workflow"])


@router.get("/novels/{novel_id}/workflow")
async def get_workflow_status(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
    project_root: Path = Depends(get_project_root),
):
    result = await service.execute("get_workflow_status", {"novel_id": novel_id})
    if "error" in result:
        raise HTTPException(500, result["error"])

    stage = None
    book_state_path = project_root / "data" / "novels" / novel_id / "data" / "workflows" / "book_state.yaml"
    if book_state_path.exists():
        import yaml

        bs = yaml.safe_load(book_state_path.read_text(encoding="utf-8")) or {}
        stage = bs.get("stage")

    return {
        "novel_id": novel_id,
        "stage": stage,
        "active": result.get("active", []),
        "complete": result.get("complete", []),
        "active_count": result.get("active_count", 0),
    }


@router.post("/novels/{novel_id}/workflow/{chapter_id}/start")
async def start_workflow(
    novel_id: str,
    chapter_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("start_workflow", {"novel_id": novel_id, "chapter_id": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.post("/novels/{novel_id}/workflow/{chapter_id}/advance")
async def advance_workflow(
    novel_id: str,
    chapter_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("advance_workflow", {"novel_id": novel_id, "chapter_id": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result
