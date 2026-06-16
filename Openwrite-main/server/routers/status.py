"""Status and doctor routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends

from server.dependencies import get_project_root, get_tool_executor_service
from server.models.responses import StatusResponse
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["status"])


@router.get("/novels/{novel_id}/status", response_model=StatusResponse)
async def get_status(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("get_status", {"novel_id": novel_id})
    if "error" in result:
        return StatusResponse(novel_id=novel_id)
    snapshots = result.get("snapshots", [])
    if isinstance(snapshots, int):
        snapshots = []
    return StatusResponse(
        novel_id=result.get("novel_id", novel_id),
        current_arc=result.get("current_arc"),
        current_chapter=result.get("current_chapter"),
        chapters_written=result.get("chapters_written", 0),
        snapshots=snapshots,
        book_stage=result.get("book_stage"),
    )


@router.post("/novels/{novel_id}/doctor")
async def run_doctor(
    novel_id: str,
    project_root: Path = Depends(get_project_root),
):
    checks = []
    config_path = project_root / "novel_config.yaml"
    checks.append({"check": "novel_config.yaml", "ok": config_path.exists()})

    novels_dir = project_root / "data" / "novels"
    checks.append({"check": "data/novels/", "ok": novels_dir.exists()})

    novel_dir = novels_dir / novel_id
    checks.append({"check": f"data/novels/{novel_id}/", "ok": novel_dir.exists()})

    if novel_dir.exists():
        src = novel_dir / "src"
        checks.append({"check": "src/outline.md", "ok": (src / "outline.md").exists()})
        checks.append({"check": "src/story/", "ok": (src / "story").is_dir()})

    try:
        from tools.llm.client import LLMConfig

        LLMConfig.from_env()
        checks.append({"check": "LLM config", "ok": True})
    except Exception as e:
        checks.append({"check": "LLM config", "ok": False, "detail": str(e)})

    return {"checks": checks, "all_ok": all(c["ok"] for c in checks)}
