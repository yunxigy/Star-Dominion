"""World entity routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_project_root, get_tool_executor_service
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["world"])


@router.get("/novels/{novel_id}/world/entities")
async def list_world_entities(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("query_world", {"novel_id": novel_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return {"entities": result.get("entities", result.get("results", []))}


@router.get("/novels/{novel_id}/world/entities/{entity_id}")
async def get_world_entity(
    novel_id: str,
    entity_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("query_world", {"novel_id": novel_id, "entity_id": entity_id})
    if "error" in result:
        raise HTTPException(404, result["error"])
    return {"entity": result}


@router.get("/novels/{novel_id}/world/relations")
async def get_world_relations(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("get_world_relations", {"novel_id": novel_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return {"relations": result.get("relations", [])}
