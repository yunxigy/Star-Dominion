"""Novel management routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from server.dependencies import get_config, get_project_root
from server.models.requests import NovelConfigUpdate
from server.models.responses import ErrorResponse, NovelConfigResponse, NovelInfo

router = APIRouter(tags=["novels"])


def _load_config(project_root: Path, novel_id: str = "") -> dict:
    """加载小说配置：优先读小说目录，回退全局配置。"""
    import yaml

    # 优先读小说独立配置
    if novel_id:
        novel_config = project_root / "data" / "novels" / novel_id / "novel_config.yaml"
        if novel_config.exists():
            cfg = yaml.safe_load(novel_config.read_text(encoding="utf-8")) or {}
            cfg.setdefault("novel_id", novel_id)
            return cfg

    # 回退全局配置
    global_config = project_root / "novel_config.yaml"
    if global_config.exists():
        return yaml.safe_load(global_config.read_text(encoding="utf-8")) or {}

    return {}


def _save_config(project_root: Path, novel_id: str, config: dict) -> None:
    """保存小说配置到小说目录，同时更新全局配置的 novel_id。"""
    import yaml

    # 保存到小说独立配置
    if novel_id:
        novel_dir = project_root / "data" / "novels" / novel_id
        novel_dir.mkdir(parents=True, exist_ok=True)
        novel_config = novel_dir / "novel_config.yaml"
        novel_config.write_text(
            yaml.safe_dump(config, allow_unicode=True, default_flow_style=False),
            encoding="utf-8",
        )

    # 同步更新全局配置的 novel_id（让 CLI 工具也能识别当前小说）
    global_config = project_root / "novel_config.yaml"
    global_cfg = {}
    if global_config.exists():
        global_cfg = yaml.safe_load(global_config.read_text(encoding="utf-8")) or {}
    global_cfg["novel_id"] = novel_id
    global_cfg["style_id"] = config.get("style_id", novel_id)
    global_cfg["current_arc"] = config.get("current_arc", "arc_001")
    global_cfg["current_chapter"] = config.get("current_chapter", "")
    global_config.write_text(
        yaml.safe_dump(global_cfg, allow_unicode=True, default_flow_style=False),
        encoding="utf-8",
    )


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
    config = _load_config(project_root, novel_id)
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
    config = _load_config(project_root, novel_id)
    for field in ["novel_id", "style_id", "current_arc", "current_chapter", "default_word_count", "max_tokens"]:
        val = getattr(update, field, None)
        if val is not None:
            config[field] = val
    _save_config(project_root, novel_id, config)
    return NovelConfigResponse(
        novel_id=config.get("novel_id", novel_id),
        style_id=config.get("style_id"),
        current_arc=config.get("current_arc"),
        current_chapter=config.get("current_chapter"),
        default_word_count=config.get("default_word_count"),
        max_tokens=config.get("max_tokens"),
    )


@router.delete("/novels/{novel_id}")
async def delete_novel(
    novel_id: str,
    project_root: Path = Depends(get_project_root),
):
    """删除小说项目（移到回收站）。"""
    import shutil
    import re

    if not re.match(r"^[a-zA-Z0-9_-]+$", novel_id):
        raise HTTPException(400, f"Invalid novel_id: {novel_id}")

    novel_dir = project_root / "data" / "novels" / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, f"Novel {novel_id} not found")

    # Move to trash instead of permanent delete
    trash_dir = project_root / "data" / "trash" / f"novel_{novel_id}"
    trash_dir.parent.mkdir(parents=True, exist_ok=True)
    if trash_dir.exists():
        shutil.rmtree(trash_dir)
    shutil.move(str(novel_dir), str(trash_dir))

    # Update global config if it pointed to this novel
    global_config = project_root / "novel_config.yaml"
    if global_config.exists():
        import yaml
        cfg = yaml.safe_load(global_config.read_text(encoding="utf-8")) or {}
        if cfg.get("novel_id") == novel_id:
            cfg["novel_id"] = ""
            global_config.write_text(
                yaml.safe_dump(cfg, allow_unicode=True, default_flow_style=False),
                encoding="utf-8",
            )

    return {"ok": True, "novel_id": novel_id, "deleted": True, "trash_path": str(trash_dir)}
