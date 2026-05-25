"""Sync routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends

from server.dependencies import get_project_root
from server.models.responses import SyncResponse

router = APIRouter(tags=["sync"])


@router.get("/novels/{novel_id}/sync", response_model=SyncResponse)
async def check_sync(novel_id: str, project_root: Path = Depends(get_project_root)):
    try:
        from tools.source_sync import check_sync_status

        result = check_sync_status(project_root)
        return SyncResponse(ok=True, message="Sync check complete", details=result)
    except Exception as e:
        return SyncResponse(ok=False, message=str(e))


@router.post("/novels/{novel_id}/sync", response_model=SyncResponse)
async def run_sync(novel_id: str, project_root: Path = Depends(get_project_root)):
    try:
        from tools.source_sync import sync_src_to_data

        result = sync_src_to_data(project_root)
        return SyncResponse(ok=True, message="Sync complete", details=result)
    except Exception as e:
        return SyncResponse(ok=False, message=str(e))
