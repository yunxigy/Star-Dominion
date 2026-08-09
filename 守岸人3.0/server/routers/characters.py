# -*- coding: utf-8 -*-
"""角色卡路由"""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.character import Character, CharacterTTSConfig
from ..models.character_db import CharacterDB
from ..models.user import User
from ..services.resource_access import (
    can_edit_character,
    can_read_character,
    require_editable_character,
    require_readable_character,
)

router = APIRouter(prefix="/api/characters", tags=["characters"])

# 这些会在 main.py 中注入
characters_dir: Path = None
voices_dir: Path = None


def init_router(chars_dir: Path, v_dir: Path):
    global characters_dir, voices_dir
    characters_dir = chars_dir
    voices_dir = v_dir


def _is_allowed_to_edit(character: CharacterDB, current_user: User) -> bool:
    """检查用户是否可以编辑角色"""
    return can_edit_character(character, current_user)


def _is_allowed_to_read(character: CharacterDB, current_user: User) -> bool:
    """检查用户是否可以查看角色"""
    return can_read_character(character, current_user)


def _is_nsfw_visible(character: CharacterDB, db: Session) -> bool:
    """检查NSFW角色是否可见"""
    if not character.is_nsfw:
        return True
    # 检查NSFW开关
    from ..models.system_config import SystemConfig
    config = db.query(SystemConfig).filter(SystemConfig.key == "nsfw_enabled").first()
    if config and config.value.get("enabled"):
        return True
    return False


def _load_file_character(char_id: str) -> Character:
    path = characters_dir / f"{char_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="角色卡不存在")
    return Character.load(path)


def _character_from_db(character: CharacterDB) -> Character:
    return Character(
        id=character.id,
        name=character.name,
        description=character.description or "",
        personality=character.personality or "",
        system_prompt=character.system_prompt or "",
        first_mes=character.first_mes or "",
        mes_example=character.mes_example or "",
        avatar=character.avatar_url or "",
        tts=CharacterTTSConfig(
            enabled=character.tts_enabled,
            model=character.tts_model or "mimo-v2.5-tts-voiceclone",
            voice=character.tts_voice or "冰糖",
            ref_audio_path=character.tts_ref_audio_path or "",
            ref_audio_filename=character.tts_ref_audio_filename or "",
            style_prompt=character.tts_style_prompt or "",
        ),
    )


@router.get("")
async def list_characters(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取所有角色卡列表（权限+NSFW过滤）"""
    query = db.query(CharacterDB)

    # 权限过滤
    if current_user.role != "admin":
        query = query.filter(
            (CharacterDB.creator_id == current_user.id)
            | (CharacterDB.user_id == current_user.id)
            | (CharacterDB.is_public == True)
        )

    db_characters = query.order_by(CharacterDB.updated_at.desc()).all()

    # NSFW 过滤
    from ..services.nsfw_filter import NSFWFilter
    nsfw_filter = NSFWFilter(db)
    if not nsfw_filter.enabled:
        db_characters = [c for c in db_characters if not c.is_nsfw]
    db_ids = {c.id for c in db_characters}

    # 兼容旧版 JSON 角色卡
    file_characters = [c for c in Character.load_all(characters_dir) if c.id not in db_ids]

    return JSONResponse(content=[c.to_dict() for c in db_characters] + [c.to_dict() for c in file_characters])


@router.get("/{char_id}")
async def get_character(
    char_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取单个角色卡"""
    character = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
    if character:
        character = require_readable_character(db, current_user, char_id)
        return JSONResponse(content=character.to_dict())

    return JSONResponse(content=_load_file_character(char_id).to_dict())


@router.post("")
async def create_character(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    name: str = Form(""),
    description: str = Form(""),
    personality: str = Form(""),
    system_prompt: str = Form(""),
    first_mes: str = Form(""),
    mes_example: str = Form(""),
    tts_model: str = Form("mimo-v2.5-tts-voiceclone"),
    tts_voice: str = Form("冰糖"),
    tts_style_prompt: str = Form(""),
):
    """创建角色卡"""
    character = CharacterDB(
        user_id=current_user.id,
        creator_id=current_user.id,
        name=name,
        description=description,
        personality=personality,
        system_prompt=system_prompt,
        first_mes=first_mes,
        mes_example=mes_example,
        tts_enabled=True,
        tts_model=tts_model,
        tts_voice=tts_voice,
        tts_style_prompt=tts_style_prompt,
    )
    db.add(character)
    db.commit()
    db.refresh(character)
    return JSONResponse(content=character.to_dict(), status_code=201)


@router.put("/{char_id}")
async def update_character(
    char_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    name: str = Form(""),
    description: str = Form(""),
    personality: str = Form(""),
    system_prompt: str = Form(""),
    first_mes: str = Form(""),
    mes_example: str = Form(""),
    tts_model: str = Form("mimo-v2.5-tts-voiceclone"),
    tts_voice: str = Form("冰糖"),
    tts_style_prompt: str = Form(""),
    tts_enabled: bool = Form(True),
):
    """更新角色卡"""
    character = require_editable_character(db, current_user, char_id)

    character.name = name or character.name
    character.description = description or character.description
    character.personality = personality or character.personality
    character.system_prompt = system_prompt or character.system_prompt
    character.first_mes = first_mes or character.first_mes
    character.mes_example = mes_example or character.mes_example
    character.tts_enabled = tts_enabled
    character.tts_model = tts_model or character.tts_model
    character.tts_voice = tts_voice or character.tts_voice
    character.tts_style_prompt = tts_style_prompt or character.tts_style_prompt

    db.commit()
    db.refresh(character)
    return JSONResponse(content=character.to_dict())


@router.delete("/{char_id}")
async def delete_character(
    char_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除角色卡"""
    character = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
    if not character:
        # 兼容旧版 JSON 角色卡
        if current_user.role != "admin":
            raise HTTPException(status_code=403, detail="旧版角色卡仅管理员可修改")
        file_char = _load_file_character(char_id)
        file_char.delete(characters_dir)
        return {"status": "ok"}

    character = require_editable_character(db, current_user, char_id)

    if character.avatar_url:
        avatar_name = character.avatar_url.replace("/avatars/", "")
        avatar_path = characters_dir / "avatars" / avatar_name
        if avatar_path.exists():
            avatar_path.unlink()

    db.delete(character)
    db.commit()
    return {"status": "ok"}


@router.post("/{char_id}/avatar")
async def upload_avatar(
    char_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """上传角色头像"""
    character = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
    if not character:
        if current_user.role != "admin":
            raise HTTPException(status_code=403, detail="旧版角色卡仅管理员可修改")
        file_char = _load_file_character(char_id)
        ext = Path(file.filename or "avatar.png").suffix.lower() or ".png"
        if ext not in [".png", ".jpg", ".jpeg", ".webp"]:
            raise HTTPException(status_code=400, detail="头像仅支持 png、jpg、webp 格式")
        avatar_name = f"{char_id}{ext}"
        avatar_dir = characters_dir / "avatars"
        avatar_dir.mkdir(parents=True, exist_ok=True)
        with open(avatar_dir / avatar_name, "wb") as f:
            shutil.copyfileobj(file.file, f)
        file_char.avatar = avatar_name
        file_char.save(characters_dir)
        return {"avatar": avatar_name}

    character = require_editable_character(db, current_user, char_id)

    ext = Path(file.filename).suffix.lower() or ".png"
    if ext not in [".png", ".jpg", ".jpeg", ".webp"]:
        raise HTTPException(status_code=400, detail="头像仅支持 png、jpg、webp 格式")

    avatar_name = f"{char_id}{ext}"
    avatar_dir = characters_dir / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)

    with open(avatar_dir / avatar_name, "wb") as f:
        shutil.copyfileobj(file.file, f)

    character.avatar_url = f"/avatars/{avatar_name}"
    db.commit()
    db.refresh(character)
    return {"avatar": character.avatar_url}


@router.post("/{char_id}/voice")
async def upload_voice(
    char_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """上传角色参考音频"""
    character = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
    if not character:
        if current_user.role != "admin":
            raise HTTPException(status_code=403, detail="旧版角色卡仅管理员可修改")
        file_char = _load_file_character(char_id)
        ext = Path(file.filename).suffix or ".wav"
        voice_name = f"{char_id}{ext}"
        voices_dir.mkdir(parents=True, exist_ok=True)
        with open(voices_dir / voice_name, "wb") as f:
            shutil.copyfileobj(file.file, f)
        file_char.tts.ref_audio_path = str(voices_dir / voice_name)
        file_char.tts.ref_audio_filename = file.filename
        file_char.save(characters_dir)
        return {"voice": voice_name}

    character = require_editable_character(db, current_user, char_id)

    ext = Path(file.filename).suffix.lower() or ".wav"
    voice_name = f"{char_id}{ext}"
    voices_dir.mkdir(parents=True, exist_ok=True)

    with open(voices_dir / voice_name, "wb") as f:
        shutil.copyfileobj(file.file, f)

    character.tts_ref_audio_path = str(voices_dir / voice_name)
    character.tts_ref_audio_filename = file.filename
    db.commit()
    return {"voice": voice_name}


# ========== 导入导出 ==========

@router.post("/import")
async def import_character(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
):
    """导入角色卡（支持 PNG / JSON）"""
    from ..utils.character_card import read_card_from_png, import_from_json, tavern_v2_to_card
    import tempfile

    ext = Path(file.filename).suffix.lower()

    # 保存临时文件
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        if ext == ".png":
            card_data = read_card_from_png(tmp_path)
            if not card_data:
                raise HTTPException(status_code=400, detail="PNG 中未找到角色卡数据")
            card_dict = tavern_v2_to_card(card_data)
        elif ext == ".json":
            card_dict = import_from_json(tmp_path)
            if not card_dict:
                raise HTTPException(status_code=400, detail="无效的角色卡 JSON")
        else:
            raise HTTPException(status_code=400, detail="不支持的文件格式，请使用 PNG 或 JSON")

        # 创建角色
        new_char = CharacterDB(
            name=card_dict.get("name", "未命名"),
            description=card_dict.get("description", ""),
            personality=card_dict.get("personality", ""),
            system_prompt=card_dict.get("system_prompt", ""),
            first_mes=card_dict.get("first_mes", ""),
            creator_id=current_user.id,
        )
        db.add(new_char)
        db.commit()
        db.refresh(new_char)

        return {"id": new_char.id, "name": new_char.name, "message": "导入成功"}

    finally:
        Path(tmp_path).unlink(missing_ok=True)


@router.get("/{char_id}/export/json")
async def export_character_json(
    char_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """导出角色卡为 Tavern Card V2 JSON"""
    from ..utils.character_card import card_to_tavern_v2

    character = require_readable_character(db, current_user, char_id)

    char_obj = Character(
        id=character.id,
        name=character.name or "",
        description=character.description or "",
        personality=character.personality or "",
        system_prompt=character.system_prompt or "",
        first_mes=character.first_mes or "",
    )

    from ..utils.character_card import export_to_json
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w", encoding="utf-8") as tmp:
        export_to_json(char_obj, tmp.name)
        tmp_path = tmp.name

    from fastapi.responses import FileResponse
    return FileResponse(
        tmp_path,
        media_type="application/json",
        filename=f"{character.name or char_id}.json",
    )


@router.get("/{char_id}/export/png")
async def export_character_png(
    char_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """导出角色卡为 PNG（嵌入 tEXt chunk）"""
    from ..utils.character_card import card_to_tavern_v2, write_card_to_png
    import tempfile

    character = require_readable_character(db, current_user, char_id)

    # 查找头像作为源 PNG
    avatar_path = None
    if character.avatar_url:
        # 去掉开头的 /avatars/ 前缀避免重复拼接
        avatar_name = character.avatar_url.lstrip("/").replace("avatars/", "").replace("avatars\\", "")
        candidate = characters_dir / "avatars" / avatar_name
        if candidate.exists():
            avatar_path = str(candidate)

    if not avatar_path:
        # 创建一个默认的纯色 PNG
        if HAS_PILLOW:
            img = Image.new("RGB", (512, 512), color=(0, 119, 182))
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                img.save(tmp, "PNG")
                avatar_path = tmp.name
        else:
            raise HTTPException(status_code=500, detail="需要安装 Pillow 来导出 PNG")

    char_obj = Character(
        id=character.id,
        name=character.name or "",
        description=character.description or "",
        personality=character.personality or "",
        system_prompt=character.system_prompt or "",
        first_mes=character.first_mes or "",
    )

    tavern_data = card_to_tavern_v2(char_obj)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        output_path = tmp.name

    write_card_to_png(tavern_data, avatar_path, output_path)

    from fastapi.responses import FileResponse
    return FileResponse(
        output_path,
        media_type="image/png",
        filename=f"{character.name or char_id}.png",
    )
