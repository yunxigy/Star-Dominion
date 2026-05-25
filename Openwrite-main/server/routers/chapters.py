"""Chapter routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_project_root, get_tool_executor_service
from server.models.requests import WriteChapterRequest
from server.models.responses import (
    ChapterContentResponse,
    ChapterInfo,
    ChapterListResponse,
    ReviewChapterResponse,
    WriteChapterResponse,
)
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["chapters"])


def _get_novel_dir(project_root: Path, novel_id: str) -> Path:
    d = project_root / "data" / "novels" / novel_id
    if not d.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")
    return d


@router.get("/novels/{novel_id}/chapters", response_model=ChapterListResponse)
async def list_chapters(
    novel_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("list_chapters", {})
    if "error" in result:
        return ChapterListResponse(chapters=[])
    chapters = [
        ChapterInfo(number=c.get("number", 0), chapter_id=c.get("chapter_id", ""), title=c.get("title"))
        for c in result.get("chapters", [])
    ]
    return ChapterListResponse(chapters=chapters)


@router.get("/novels/{novel_id}/chapters/{chapter_id}", response_model=ChapterContentResponse)
async def get_chapter(
    novel_id: str,
    chapter_id: str,
    project_root: Path = Depends(get_project_root),
):
    novel_dir = _get_novel_dir(project_root, novel_id)
    manuscript_dir = novel_dir / "data" / "manuscript"
    if not manuscript_dir.exists():
        raise HTTPException(404, "No manuscripts directory")

    chapter_file = None
    for f in manuscript_dir.rglob(f"{chapter_id}.md"):
        chapter_file = f
        break
    if not chapter_file:
        raise HTTPException(404, f"Chapter {chapter_id} not found")

    content = chapter_file.read_text(encoding="utf-8")
    word_count = len(content)

    title = None
    for line in content.split("\n"):
        if line.startswith("# "):
            title = line[2:].strip()
            break

    return ChapterContentResponse(
        chapter_id=chapter_id, title=title, content=content, word_count=word_count
    )


@router.post("/novels/{novel_id}/chapters/{chapter_id}/write", response_model=WriteChapterResponse)
async def write_chapter(
    novel_id: str,
    chapter_id: str,
    req: WriteChapterRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    args: dict = {"chapter": chapter_id}
    if req.guidance:
        args["guidance"] = req.guidance
    if req.temperature is not None:
        args["temperature"] = req.temperature
    if req.no_review:
        args["no_review"] = True

    result = await service.execute("write_chapter", args)
    if "error" in result:
        raise HTTPException(500, result["error"])
    return WriteChapterResponse(
        ok=result.get("ok", False),
        chapter_id=result.get("chapter_id", chapter_id),
        title=result.get("title"),
        word_count=result.get("word_count", 0),
        draft_path=result.get("draft_path"),
        truth_updates=result.get("truth_updates", {}),
    )


@router.post("/novels/{novel_id}/chapters/{chapter_id}/review", response_model=ReviewChapterResponse)
async def review_chapter(
    novel_id: str,
    chapter_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("review_chapter", {"chapter": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return ReviewChapterResponse(
        ok=result.get("ok", False),
        chapter_id=result.get("chapter_id", chapter_id),
        passed=result.get("passed", False),
        score=result.get("score"),
        issues=result.get("issues", []),
    )


@router.get("/novels/{novel_id}/chapters/{chapter_id}/context")
async def get_chapter_context(
    novel_id: str,
    chapter_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("get_context", {"chapter": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.post("/novels/{novel_id}/chapters/{chapter_id}/assemble")
async def assemble_chapter(
    novel_id: str,
    chapter_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("get_context", {"chapter": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result
