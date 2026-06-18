"""Chapter routes."""

from __future__ import annotations

import asyncio
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

# Write locks: prevent concurrent writes to the same chapter
_write_locks: dict[str, asyncio.Lock] = {}


def _get_write_lock(key: str) -> asyncio.Lock:
    if key not in _write_locks:
        _write_locks[key] = asyncio.Lock()
    return _write_locks[key]


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
    result = await service.execute("list_chapters", {"novel_id": novel_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
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

    chapter_file = manuscript_dir / f"{chapter_id}.md"
    if not chapter_file.exists():
        # Fallback: search subdirectories for backward compatibility
        for f in manuscript_dir.rglob(f"{chapter_id}.md"):
            if f.stem == chapter_id:
                chapter_file = f
                break
    if not chapter_file.exists():
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
    project_root: Path = Depends(get_project_root),
):
    lock_key = f"{novel_id}:{chapter_id}"
    lock = _get_write_lock(lock_key)
    # Wait up to 10 seconds for lock instead of instant 409
    try:
        await asyncio.wait_for(lock.acquire(), timeout=10.0)
    except asyncio.TimeoutError:
        raise HTTPException(409, f"Chapter {chapter_id} is already being written. Please wait.")

    try:
        # Save snapshot of current chapter before overwriting
        try:
            from tools.chapter_history import save_snapshot
            manuscript_dir = project_root / "data" / "novels" / novel_id / "data" / "manuscript"
            if manuscript_dir.exists():
                for f in manuscript_dir.rglob(f"**/{chapter_id}.md"):
                    if f.is_file() and f.stem == chapter_id:
                        current_content = f.read_text(encoding="utf-8")
                        save_snapshot(project_root, novel_id, chapter_id, current_content, reason="ai_write")
                        break
        except Exception:
            pass  # Don't fail the write if snapshot fails

        args: dict = {"novel_id": novel_id, "chapter_id": chapter_id}
        if req.guidance:
            args["guidance"] = req.guidance
        if req.temperature is not None:
            args["temperature"] = req.temperature
        if req.no_review:
            args["no_review"] = True

        result = await service.execute("write_chapter", args)
        if "error" in result:
            raise HTTPException(500, result["error"])

        # Auto-review after writing (unless no_review is set)
        review_result = None
        if not req.no_review and result.get("ok"):
            try:
                review_result = await service.execute("review_chapter", {
                    "novel_id": novel_id,
                    "chapter_id": result.get("chapter_id", chapter_id),
                })
            except Exception:
                pass  # Don't fail the write if review fails

        return WriteChapterResponse(
            ok=result.get("ok", False),
            chapter_id=result.get("chapter_id", chapter_id),
            title=result.get("title"),
            word_count=result.get("word_count", 0),
            draft_path=result.get("draft_path"),
            truth_updates=result.get("truth_updates", {}),
            review=review_result,
        )
    finally:
        lock.release()


@router.post("/novels/{novel_id}/chapters/{chapter_id}/review", response_model=ReviewChapterResponse)
async def review_chapter(
    novel_id: str,
    chapter_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("review_chapter", {"novel_id": novel_id, "chapter_id": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return ReviewChapterResponse(
        ok=result.get("ok", False),
        chapter_id=result.get("chapter_id", chapter_id),
        passed=result.get("passed", False),
        score=result.get("score"),
        issues=result.get("issues", []),
    )


@router.post("/novels/{novel_id}/chapters/write-and-review")
async def write_and_review(
    novel_id: str,
    req: WriteChapterRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
    project_root: Path = Depends(get_project_root),
):
    """写章节 + 自动审查 + 低分自动修改。"""
    result = await service.execute("write_and_review", {
        "novel_id": novel_id,
        "guidance": req.guidance or "",
        "score_threshold": 70,
        "max_revisions": 2,
    })
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.get("/novels/{novel_id}/chapters/{chapter_id}/context")
async def get_chapter_context(
    novel_id: str,
    chapter_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("get_context", {"novel_id": novel_id, "chapter_id": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.post("/novels/{novel_id}/chapters/{chapter_id}/assemble")
async def assemble_chapter(
    novel_id: str,
    chapter_id: str,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("assemble_chapter", {"novel_id": novel_id, "chapter_id": chapter_id})
    if "error" in result:
        raise HTTPException(500, result["error"])
    return result


@router.delete("/novels/{novel_id}/chapters/{chapter_id}")
async def delete_chapter(
    novel_id: str,
    chapter_id: str,
    project_root: Path = Depends(get_project_root),
):
    """删除章节文件。"""
    import re
    if not re.match(r"^ch_\d+$", chapter_id):
        raise HTTPException(400, f"Invalid chapter_id: {chapter_id}")

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    manuscript_dir = novel_dir / "data" / "manuscript"
    deleted = False
    for f in manuscript_dir.rglob(f"{chapter_id}.md"):
        if f.is_file() and f.stem == chapter_id:
            # Move to trash instead of permanent delete
            trash_dir = novel_dir / "data" / "trash"
            trash_dir.mkdir(parents=True, exist_ok=True)
            import shutil
            shutil.move(str(f), str(trash_dir / f.name))
            deleted = True
            break

    if not deleted:
        raise HTTPException(404, f"Chapter {chapter_id} not found")
    return {"ok": True, "chapter_id": chapter_id, "deleted": True}
