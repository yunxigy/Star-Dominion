"""Tools routes — validate, chunk, compress, radar, init, source management."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server.dependencies import get_project_root, get_tool_executor_service
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["tools"])


# ── 验证类 ──────────────────────────────────────────────────

@router.post("/novels/{novel_id}/validate/truth")
async def validate_truth(
    novel_id: str,
    chapter_id: str = "latest",
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    """验证真相文件一致性。"""
    result = await service.execute("validate_truth", {"novel_id": novel_id, "chapter_id": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.post("/novels/{novel_id}/validate/post-write")
async def validate_post_write(
    novel_id: str,
    chapter_id: str = "latest",
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    """写后验证。"""
    result = await service.execute("validate_post_write", {"novel_id": novel_id, "chapter_id": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


# ── 文本处理 ──────────────────────────────────────────────────

class ChunkRequest(BaseModel):
    text: str = ""
    chapter_id: str = ""
    chunk_size: int = 3000


class CompressRequest(BaseModel):
    arc_id: str = "arc_001"
    section_id: str = ""


@router.post("/novels/{novel_id}/tools/chunk")
async def chunk_text(
    novel_id: str,
    req: ChunkRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    """文本分块。"""
    result = await service.execute("chunk_text", {
        "novel_id": novel_id,
        "text": req.text,
        "chapter_id": req.chapter_id,
        "chunk_size": req.chunk_size,
    })
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.post("/novels/{novel_id}/tools/compress")
async def compress_section(
    novel_id: str,
    req: CompressRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    """压缩章节/段落。"""
    result = await service.execute("compress_section", {
        "novel_id": novel_id,
        "arc_id": req.arc_id,
        "section_id": req.section_id,
    })
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


# ── 初始化 ──────────────────────────────────────────────────

class InitRequest(BaseModel):
    novel_id: str
    title: str = ""
    author: str = ""


@router.post("/novels/init")
async def init_project(
    req: InitRequest,
    project_root: Path = Depends(get_project_root),
):
    """初始化新小说项目。"""
    from tools.init_project import init_project as _init

    novel_dir = project_root / "data" / "novels" / req.novel_id
    if novel_dir.exists():
        raise HTTPException(409, f"Novel {req.novel_id} already exists")

    try:
        import io, contextlib
        # Suppress print output (may have encoding issues on Windows)
        with contextlib.redirect_stdout(io.StringIO()):
            _init(project_root, req.novel_id, title=req.title or req.novel_id)
        return {"ok": True, "novel_id": req.novel_id, "path": str(novel_dir)}
    except Exception as e:
        raise HTTPException(500, f"Init failed: {e}")


# ── 雷达/市场分析 ──────────────────────────────────────────────

class RadarRequest(BaseModel):
    query: str = ""
    genre: str = ""


@router.post("/novels/{novel_id}/radar")
async def run_radar(
    novel_id: str,
    req: RadarRequest,
    project_root: Path = Depends(get_project_root),
):
    """市场趋势分析。"""
    from tools.radar import RadarAgent
    from tools.llm import LLMClient, LLMConfig
    from tools.agent import AgentContext

    try:
        llm_config = LLMConfig.from_env()
        client = LLMClient(llm_config)
        agent_ctx = AgentContext(client, llm_config.model, str(project_root))
        radar = RadarAgent(agent_ctx)

        result = await radar.scan_market(
            top_n=5,
        )
        return {"ok": True, "analysis": str(result)}
    except Exception as e:
        raise HTTPException(500, f"Radar failed: {e}")


# ── Source Pack 管理 ──────────────────────────────────────────

@router.get("/novels/{novel_id}/sources")
async def list_sources(
    novel_id: str,
    project_root: Path = Depends(get_project_root),
):
    """列出所有 source pack。"""
    sources_dir = project_root / "data" / "novels" / novel_id / "data" / "sources"
    if not sources_dir.exists():
        return {"sources": []}

    sources = []
    for d in sorted(sources_dir.iterdir()):
        if not d.is_dir():
            continue
        meta = {}
        source_md = d / "source.md"
        if source_md.exists():
            content = source_md.read_text(encoding="utf-8")
            meta["preview"] = content[:200]
        sources.append({
            "source_id": d.name,
            "has_style": (d / "style").is_dir(),
            "has_setting": (d / "setting").is_dir(),
            **meta,
        })
    return {"sources": sources}


@router.get("/novels/{novel_id}/sources/{source_id}")
async def get_source(
    novel_id: str,
    source_id: str,
    project_root: Path = Depends(get_project_root),
):
    """获取 source pack 详情。"""
    source_dir = project_root / "data" / "novels" / novel_id / "data" / "sources" / source_id
    if not source_dir.exists():
        raise HTTPException(404, f"Source {source_id} not found")

    result = {"source_id": source_id, "files": []}
    for f in sorted(source_dir.rglob("*")):
        if f.is_file():
            result["files"].append({
                "path": str(f.relative_to(source_dir)),
                "size": f.stat().st_size,
            })

    source_md = source_dir / "source.md"
    if source_md.exists():
        result["content"] = source_md.read_text(encoding="utf-8")[:2000]

    return result


@router.post("/novels/{novel_id}/sources/{source_id}/promote")
async def promote_source(
    novel_id: str,
    source_id: str,
    project_root: Path = Depends(get_project_root),
):
    """将 source pack 晋升为当前项目风格。"""
    try:
        from tools.cli import _promote_source_style
        _promote_source_style(project_root, novel_id, source_id)
        return {"ok": True, "source_id": source_id, "promoted": True}
    except Exception as e:
        raise HTTPException(500, f"Promote failed: {e}")


# ── 设定提取 ──────────────────────────────────────────────────

class SettingExtractRequest(BaseModel):
    source_name: str
    source_text: str = ""
    source_path: str = ""


@router.post("/novels/{novel_id}/setting/extract")
async def extract_setting(
    novel_id: str,
    req: SettingExtractRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    """从文本提取设定。"""
    if not req.source_name:
        raise HTTPException(400, "source_name is required")
    result = await service.execute("extract_style_source", {
        "novel_id": novel_id,
        "source_name": req.source_name,
        "source_text": req.source_text or "",
        "source_path": req.source_path or "",
        "focus": "setting",
    })
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result
