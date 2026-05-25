"""Style routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_project_root, get_tool_executor_service
from server.models.requests import StyleExtractRequest, StyleSynthesizeRequest
from server.models.responses import StyleResponse
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["style"])


@router.get("/novels/{novel_id}/style", response_model=StyleResponse)
async def get_style(novel_id: str, project_root: Path = Depends(get_project_root)):
    style_dir = project_root / "data" / "novels" / novel_id / "data" / "style"
    if not style_dir.exists():
        return StyleResponse()

    composed = ""
    composed_path = style_dir / "composed.md"
    if composed_path.exists():
        composed = composed_path.read_text(encoding="utf-8")

    fingerprint: dict = {}
    fp_path = style_dir / "fingerprint.yaml"
    if fp_path.exists():
        import yaml

        fingerprint = yaml.safe_load(fp_path.read_text(encoding="utf-8")) or {}

    manifest = ""
    manifest_path = style_dir / "manifest.toml"
    if manifest_path.exists():
        manifest = manifest_path.read_text(encoding="utf-8")

    return StyleResponse(composed=composed, fingerprint=fingerprint, manifest=manifest)


@router.post("/novels/{novel_id}/style/extract")
async def extract_style(
    novel_id: str,
    req: StyleExtractRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("extract_dialogue_fingerprint", {"source_name": req.source_name})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.post("/novels/{novel_id}/style/synthesize")
async def synthesize_style(
    novel_id: str,
    req: StyleSynthesizeRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("chunk_text", {})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result
