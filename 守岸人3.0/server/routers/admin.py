# -*- coding: utf-8 -*-
"""后台管理路由 - 增强版"""
import os
import shutil
import psutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from ..database import get_db, DB_PATH
from ..models.user import User
from ..models.character_db import CharacterDB
from ..models.story import Story
from ..models.system_config import SystemConfig
from ..models.chat_db import ChatSession, ChatMessage
from ..middleware.auth import get_current_admin
from ..services.nsfw_filter import NSFWFilter

router = APIRouter(prefix="/api/admin", tags=["admin"])

# 项目根目录
ROOT_DIR = Path(__file__).parent.parent.parent
DATA_DIR = ROOT_DIR / "data"

class SystemConfigUpdate(BaseModel):
    nsfw_enabled: Optional[bool] = None

class UserRoleUpdate(BaseModel):
    role: str

class UserPasswordReset(BaseModel):
    new_password: str

# ========== 系统配置 ==========

@router.get("/config")
async def get_system_config(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """获取系统配置"""
    nsfw_filter = NSFWFilter(db)
    return {
        "nsfw_enabled": nsfw_filter.enabled,
    }

@router.put("/config")
async def update_system_config(
    req: SystemConfigUpdate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """更新系统配置"""
    nsfw_filter = NSFWFilter(db)
    if req.nsfw_enabled is not None:
        nsfw_filter.set_enabled(req.nsfw_enabled)
    return {"message": "配置已更新"}

# ========== 用户管理 ==========

@router.get("/users")
async def get_users(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """获取用户列表（含统计）"""
    users = db.query(User).all()
    result = []
    for u in users:
        data = u.to_dict()
        # 统计用户数据
        data["chat_count"] = db.query(ChatSession).filter(ChatSession.user_id == u.id).count()
        data["character_count"] = db.query(CharacterDB).filter(CharacterDB.creator_id == u.id).count()
        data["story_count"] = db.query(Story).filter(Story.creator_id == u.id).count()
        result.append(data)
    return result

@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    req: UserRoleUpdate,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """更新用户角色"""
    if req.role not in ["user", "admin"]:
        raise HTTPException(status_code=400, detail="无效的角色")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.role = req.role
    db.commit()
    return {"message": "角色已更新"}

@router.put("/users/{user_id}/status")
async def toggle_user_status(
    user_id: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """切换用户状态（启用/禁用）"""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.is_active = not user.is_active
    db.commit()
    return {"message": "状态已更新", "is_active": user.is_active}

@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: str,
    req: UserPasswordReset,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """重置用户密码"""
    from ..middleware.auth import get_password_hash

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="密码至少8位")

    user.password_hash = get_password_hash(req.new_password)
    db.commit()
    return {"message": "密码已重置"}

# ========== 内容审核 ==========

@router.get("/characters/pending")
async def get_pending_characters(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """获取待审核的公开角色"""
    characters = db.query(CharacterDB).filter(
        CharacterDB.is_public == True
    ).order_by(CharacterDB.created_at.desc()).limit(50).all()
    return [c.to_dict() for c in characters]

@router.put("/characters/{char_id}/approve")
async def approve_character(
    char_id: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """审核通过角色"""
    character = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")
    # 可以添加审核状态字段，这里简化处理
    return {"message": "审核通过"}

@router.put("/characters/{char_id}/reject")
async def reject_character(
    char_id: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """审核拒绝角色（设为私有）"""
    character = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")

    character.is_public = False
    db.commit()
    return {"message": "已设为私有"}

@router.get("/stories/pending")
async def get_pending_stories(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """获取待审核的公开剧情"""
    stories = db.query(Story).filter(
        Story.is_public == True
    ).order_by(Story.created_at.desc()).limit(50).all()
    return [s.to_dict() for s in stories]

@router.put("/stories/{story_id}/reject")
async def reject_story(
    story_id: str,
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """审核拒绝剧情（设为私有）"""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="剧情不存在")

    story.is_public = False
    db.commit()
    return {"message": "已设为私有"}

# ========== 系统监控 ==========

@router.get("/monitor")
async def get_system_monitor(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """获取系统监控数据"""
    # 用户统计
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active == True).count()

    # 内容统计
    total_characters = db.query(CharacterDB).count()
    total_stories = db.query(Story).count()
    total_sessions = db.query(ChatSession).count()
    total_messages = db.query(ChatMessage).count()

    # 磁盘占用
    db_size = DB_PATH.stat().st_size if DB_PATH.exists() else 0

    # 音频缓存大小
    audio_cache_dir = DATA_DIR / "audio_cache"
    audio_cache_size = 0
    if audio_cache_dir.exists():
        for f in audio_cache_dir.glob("*.wav"):
            audio_cache_size += f.stat().st_size

    # 角色头像大小
    avatars_dir = DATA_DIR / "characters" / "avatars"
    avatars_size = 0
    if avatars_dir.exists():
        for f in avatars_dir.iterdir():
            if f.is_file():
                avatars_size += f.stat().st_size

    # 语音文件大小
    voices_dir = DATA_DIR / "voices"
    voices_size = 0
    if voices_dir.exists():
        for f in voices_dir.rglob("*"):
            if f.is_file():
                voices_size += f.stat().st_size

    # 系统资源
    cpu_percent = psutil.cpu_percent()
    memory = psutil.virtual_memory()

    return {
        "users": {
            "total": total_users,
            "active": active_users,
        },
        "content": {
            "characters": total_characters,
            "stories": total_stories,
            "chat_sessions": total_sessions,
            "chat_messages": total_messages,
        },
        "storage": {
            "database_mb": round(db_size / 1024 / 1024, 2),
            "audio_cache_mb": round(audio_cache_size / 1024 / 1024, 2),
            "avatars_mb": round(avatars_size / 1024 / 1024, 2),
            "voices_mb": round(voices_size / 1024 / 1024, 2),
            "total_mb": round((db_size + audio_cache_size + avatars_size + voices_size) / 1024 / 1024, 2),
        },
        "system": {
            "cpu_percent": cpu_percent,
            "memory_percent": memory.percent,
            "memory_used_mb": round(memory.used / 1024 / 1024),
            "memory_total_mb": round(memory.total / 1024 / 1024),
        },
    }

# ========== 数据备份 ==========

@router.get("/backup/database")
async def backup_database(
    admin: User = Depends(get_current_admin),
):
    """导出数据库文件"""
    if not DB_PATH.exists():
        raise HTTPException(status_code=404, detail="数据库文件不存在")

    return FileResponse(
        path=str(DB_PATH),
        filename="shouanren_backup.db",
        media_type="application/octet-stream",
    )

@router.get("/backup/characters")
async def backup_characters(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """导出所有角色数据"""
    characters = db.query(CharacterDB).all()
    result = [c.to_dict() for c in characters]

    # 包含JSON文件角色
    chars_dir = DATA_DIR / "characters"
    json_chars = []
    if chars_dir.exists():
        for f in chars_dir.glob("*.json"):
            try:
                import json
                with open(f, "r", encoding="utf-8") as file:
                    json_chars.append(json.load(file))
            except:
                pass

    return {
        "database_characters": result,
        "file_characters": json_chars,
        "total": len(result) + len(json_chars),
    }

@router.get("/backup/stories")
async def backup_stories(
    admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """导出所有剧情数据"""
    stories = db.query(Story).all()
    return {
        "stories": [s.to_dict(include_details=True) for s in stories],
        "total": len(stories),
    }

@router.post("/cleanup/audio-cache")
async def cleanup_audio_cache(
    admin: User = Depends(get_current_admin),
):
    """清理音频缓存"""
    audio_cache_dir = DATA_DIR / "audio_cache"
    if not audio_cache_dir.exists():
        return {"message": "缓存目录不存在", "deleted": 0}

    count = 0
    for f in audio_cache_dir.glob("*.wav"):
        try:
            f.unlink()
            count += 1
        except:
            pass

    return {"message": f"清理完成", "deleted": count}
