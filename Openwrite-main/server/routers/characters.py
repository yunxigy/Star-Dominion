"""Character routes."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_project_root, get_tool_executor_service
from server.models.requests import CreateCharacterRequest, UpdateCharacterRequest
from server.models.responses import CharacterDetailResponse, CharacterListResponse
from server.services.tool_executor_service import ToolExecutorService

router = APIRouter(tags=["characters"])

_char_locks: dict[str, asyncio.Lock] = {}


def _get_char_lock(novel_id: str, name: str) -> asyncio.Lock:
    key = f"{novel_id}:{name}"
    if key not in _char_locks:
        _char_locks[key] = asyncio.Lock()
    return _char_locks[key]


def _get_characters_dir(project_root: Path, novel_id: str) -> Path:
    d = project_root / "data" / "novels" / novel_id / "src" / "characters"
    if not d.exists():
        raise HTTPException(404, "Characters directory not found")
    return d


def _parse_character_file(path: Path) -> dict:
    content = path.read_text(encoding="utf-8")
    name = path.stem
    tier = None
    summary = None
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            import yaml

            meta = yaml.safe_load(parts[1]) or {}
            name = meta.get("name", name)
            tier = meta.get("tier")
            summary = meta.get("summary")
    return {"name": name, "file": path.name, "tier": tier, "summary": summary}


@router.get("/novels/{novel_id}/characters", response_model=CharacterListResponse)
async def list_characters(novel_id: str, project_root: Path = Depends(get_project_root)):
    try:
        chars_dir = _get_characters_dir(project_root, novel_id)
    except HTTPException:
        return CharacterListResponse(characters=[])
    characters = [_parse_character_file(f) for f in sorted(chars_dir.glob("*.md"))]
    return CharacterListResponse(characters=characters)


@router.get("/novels/{novel_id}/characters/{name}", response_model=CharacterDetailResponse)
async def get_character(
    novel_id: str, name: str, project_root: Path = Depends(get_project_root)
):
    chars_dir = _get_characters_dir(project_root, novel_id)
    for f in chars_dir.glob("*.md"):
        if f.stem == name:
            content = f.read_text(encoding="utf-8")
            info = _parse_character_file(f)
            return CharacterDetailResponse(
                name=info["name"], content=content, tier=info["tier"], summary=info["summary"]
            )
    raise HTTPException(404, f"Character {name} not found")


@router.post("/novels/{novel_id}/characters", response_model=CharacterDetailResponse)
async def create_character(
    novel_id: str,
    req: CreateCharacterRequest,
    service: ToolExecutorService = Depends(get_tool_executor_service),
):
    result = await service.execute("create_character", {
        "novel_id": novel_id,
        "name": req.name,
        "description": req.summary or "",
        "content": req.content or "",
    })
    if "error" in result:
        raise HTTPException(500, result["error"])
    return CharacterDetailResponse(name=req.name, content=req.content or "", tier=req.tier, summary=req.summary)


@router.put("/novels/{novel_id}/characters/{name}", response_model=CharacterDetailResponse)
async def update_character(
    novel_id: str,
    name: str,
    req: UpdateCharacterRequest,
    project_root: Path = Depends(get_project_root),
):
    chars_dir = _get_characters_dir(project_root, novel_id)
    safe_name = Path(name).name
    target = chars_dir / f"{safe_name}.md"
    if not target.exists():
        raise HTTPException(404, f"Character {name} not found")
    # Verify path is within characters directory
    try:
        target.resolve().relative_to(chars_dir.resolve())
    except ValueError:
        raise HTTPException(400, "Invalid character name")
    if not req.content or not req.content.strip():
        raise HTTPException(400, "Character content cannot be empty")
    lock = _get_char_lock(novel_id, safe_name)
    async with lock:
        target.write_text(req.content, encoding="utf-8")
    info = _parse_character_file(target)
    return CharacterDetailResponse(name=info["name"], content=req.content, tier=info["tier"], summary=info["summary"])


@router.delete("/novels/{novel_id}/characters/{name}")
async def delete_character(
    novel_id: str, name: str, project_root: Path = Depends(get_project_root)
):
    chars_dir = _get_characters_dir(project_root, novel_id)
    safe_name = Path(name).name
    target = chars_dir / f"{safe_name}.md"
    if not target.exists():
        raise HTTPException(404, f"Character {name} not found")
    try:
        target.resolve().relative_to(chars_dir.resolve())
    except ValueError:
        raise HTTPException(400, "Invalid character name")
    lock = _get_char_lock(novel_id, safe_name)
    async with lock:
        target.unlink()
    return {"ok": True}
