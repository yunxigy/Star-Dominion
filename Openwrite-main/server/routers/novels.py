"""Novel management routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_config, get_project_root
from server.models.requests import NovelConfigUpdate
from server.models.responses import ErrorResponse, NovelConfigResponse, NovelInfo

router = APIRouter(tags=["novels"])


def _load_config(project_root: Path) -> dict:
    config_path = project_root / "novel_config.yaml"
    if not config_path.exists():
        return {}
    import yaml

    return yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}


def _save_config(project_root: Path, config: dict) -> None:
    import yaml

    config_path = project_root / "novel_config.yaml"
    config_path.write_text(yaml.dump(config, allow_unicode=True), encoding="utf-8")


@router.get("/novels", response_model=list[NovelInfo])
async def list_novels(project_root: Path = Depends(get_project_root)):
    novels_dir = project_root / "data" / "novels"
    if not novels_dir.exists():
        return []
    result = []
    for d in sorted(novels_dir.iterdir()):
        if not d.is_dir():
            continue
        src = d / "src"
        result.append(
            NovelInfo(
                novel_id=d.name,
                path=str(d),
                has_outline=(src / "outline.md").exists(),
                has_characters=(src / "characters").is_dir(),
                chapter_count=len(list((d / "data" / "manuscript").rglob("ch_*.md")))
                if (d / "data" / "manuscript").exists()
                else 0,
            )
        )
    return result


@router.get("/novels/{novel_id}/config", response_model=NovelConfigResponse)
async def get_novel_config(novel_id: str, project_root: Path = Depends(get_project_root)):
    config = _load_config(project_root)
    if not config:
        raise HTTPException(404, "No novel_config.yaml found")
    return NovelConfigResponse(
        novel_id=config.get("novel_id", novel_id),
        style_id=config.get("style_id"),
        current_arc=config.get("current_arc"),
        current_chapter=config.get("current_chapter"),
        default_word_count=config.get("default_word_count"),
        max_tokens=config.get("max_tokens"),
    )


@router.put("/novels/{novel_id}/config", response_model=NovelConfigResponse)
async def update_novel_config(
    novel_id: str,
    update: NovelConfigUpdate,
    project_root: Path = Depends(get_project_root),
):
    config = _load_config(project_root)
    for field in ["novel_id", "style_id", "current_arc", "current_chapter", "default_word_count", "max_tokens"]:
        val = getattr(update, field, None)
        if val is not None:
            config[field] = val
    _save_config(project_root, config)
    return NovelConfigResponse(
        novel_id=config.get("novel_id", novel_id),
        style_id=config.get("style_id"),
        current_arc=config.get("current_arc"),
        current_chapter=config.get("current_chapter"),
        default_word_count=config.get("default_word_count"),
        max_tokens=config.get("max_tokens"),
    )
