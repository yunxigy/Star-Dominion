"""Foreshadowing routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_tool_executor_service
from server.models.requests import CreateForeshadowingRequest, UpdateForeshadowingRequest
from server.models.responses import ForeshadowingListResponse
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["foreshadowing"])


@router.get("/novels/{novel_id}/foreshadowing", response_model=ForeshadowingListResponse)
async def list_foreshadowing(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("list_foreshadowing", {})
    if "error" in result:
        return ForeshadowingListResponse(nodes=[], edges=[])
    return ForeshadowingListResponse(
        nodes=result.get("nodes", []),
        edges=result.get("edges", []),
    )


@router.post("/novels/{novel_id}/foreshadowing")
async def create_foreshadowing(
    novel_id: str,
    req: CreateForeshadowingRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("create_foreshadowing", {
        "content": req.content,
        "weight": req.weight,
        "layer": req.layer,
        "target_arc": req.target_arc,
        "target_section": req.target_section,
        "target_chapter": req.target_chapter,
    })
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.put("/novels/{novel_id}/foreshadowing/{node_id}")
async def update_foreshadowing(
    novel_id: str,
    node_id: str,
    req: UpdateForeshadowingRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    args: dict = {"node_id": node_id}
    if req.content is not None:
        args["content"] = req.content
    if req.weight is not None:
        args["weight"] = req.weight
    if req.layer is not None:
        args["layer"] = req.layer
    if req.status is not None:
        args["status"] = req.status
    result = await service.execute("update_foreshadowing", args)
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.delete("/novels/{novel_id}/foreshadowing/{node_id}")
async def delete_foreshadowing(
    novel_id: str,
    node_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("delete_foreshadowing", {"node_id": node_id})
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


@router.post("/novels/{novel_id}/foreshadowing/validate")
async def validate_foreshadowing(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("validate_foreshadowing", {})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result
