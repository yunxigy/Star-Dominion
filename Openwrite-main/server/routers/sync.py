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
        from tools.source_sync import collect_sync_status

        result = collect_sync_status(project_root, novel_id)
        return SyncResponse(ok=True, message="Sync check complete", details=result)
    except Exception as e:
        return SyncResponse(ok=False, message=str(e))


@router.post("/novels/{novel_id}/sync", response_model=SyncResponse)
async def run_sync_route(novel_id: str, project_root: Path = Depends(get_project_root)):
    try:
        from tools.source_sync import collect_sync_status, run_sync

        before = collect_sync_status(project_root, novel_id)
        run_sync(project_root, novel_id)
        after = collect_sync_status(project_root, novel_id)
        return SyncResponse(
            ok=not after.get("needs_sync", False),
            message="Sync complete",
            details={"before": before, "after": after},
        )
    except Exception as e:
        return SyncResponse(ok=False, message=str(e))
