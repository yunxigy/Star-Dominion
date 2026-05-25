"""Truth file routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_tool_executor_service
from server.models.requests import UpdateTruthFileRequest
from server.models.responses import TruthFilesResponse
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["truth"])


@router.get("/novels/{novel_id}/truth", response_model=TruthFilesResponse)
async def get_truth_files(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("get_truth_files", {})
    if "error" in result:
        return TruthFilesResponse()
    return TruthFilesResponse(
        current_state=result.get("current_state", ""),
        ledger=result.get("ledger", ""),
        relationships=result.get("relationships", ""),
    )


@router.put("/novels/{novel_id}/truth/{file_name}")
async def update_truth_file(
    novel_id: str,
    file_name: str,
    req: UpdateTruthFileRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("update_truth_file", {"file_name": file_name, "content": req.content})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return {"ok": True}
