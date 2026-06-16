"""Truth file routes."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_tool_executor_service
from server.models.requests import UpdateTruthFileRequest
from server.models.responses import TruthFilesResponse
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["truth"])

_truth_locks: dict[str, asyncio.Lock] = {}


def _get_truth_lock(novel_id: str, file_name: str) -> asyncio.Lock:
    key = f"{novel_id}:{file_name}"
    if key not in _truth_locks:
        _truth_locks[key] = asyncio.Lock()
    return _truth_locks[key]

# Allowed truth file names (whitelist)
_ALLOWED_TRUTH_FILES = {"current_state", "ledger", "relationships"}


@router.get("/novels/{novel_id}/truth", response_model=TruthFilesResponse)
async def get_truth_files(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("get_truth_files", {"novel_id": novel_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
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
    if file_name not in _ALLOWED_TRUTH_FILES:
        raise HTTPException(400, f"Invalid truth file name: {file_name}. Allowed: {', '.join(sorted(_ALLOWED_TRUTH_FILES))}")
    lock = _get_truth_lock(novel_id, file_name)
    async with lock:
        result = await service.execute("update_truth_file", {"novel_id": novel_id, "file_name": file_name, "content": req.content})
        if "error" in result:
            raise HTTPException(500, result["error"])
    return {"ok": True}
