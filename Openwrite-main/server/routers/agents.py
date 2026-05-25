"""Agent session routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends

from server.dependencies import get_project_root

router = APIRouter(tags=["agents"])


@router.get("/novels/{novel_id}/agents/{agent_type}/session")
async def get_agent_session(
    novel_id: str,
    agent_type: str,
    project_root: Path = Depends(get_project_root),
):
    session_path = (
        project_root / "data" / "novels" / novel_id / "data" / "workflows" / "agent_session.yaml"
    )
    if not session_path.exists():
        return {"session": None, "exists": False}
    import yaml

    session = yaml.safe_load(session_path.read_text(encoding="utf-8")) or {}
    return {"session": session, "exists": True}


@router.delete("/novels/{novel_id}/agents/{agent_type}/session")
async def reset_agent_session(
    novel_id: str,
    agent_type: str,
    project_root: Path = Depends(get_project_root),
):
    session_path = (
        project_root / "data" / "novels" / novel_id / "data" / "workflows" / "agent_session.yaml"
    )
    if session_path.exists():
        session_path.unlink()
    return {"ok": True}
