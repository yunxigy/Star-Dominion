# -*- coding: utf-8 -*-
"""角色羁绊系统路由"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from ..database import get_db
from ..models.user import User
from ..models.affinity import CharacterAffinity, UserPreference, get_level_name, get_next_level
from ..middleware.auth import get_current_user

router = APIRouter(prefix="/api/affinity", tags=["affinity"])


class PreferenceCreate(BaseModel):
    character_id: Optional[str] = None
    preference_type: str  # name, hobby, event, dislike, custom
    content: str
    importance: Optional[int] = 5


# ========== 羁绊查询 ==========

@router.get("/characters/{character_id}")
async def get_affinity(
    character_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户与角色的羁绊"""
    affinity = db.query(CharacterAffinity).filter(
        CharacterAffinity.user_id == current_user.id,
        CharacterAffinity.character_id == character_id,
    ).first()

    if not affinity:
        # 创建默认羁绊
        affinity = CharacterAffinity(
            user_id=current_user.id,
            character_id=character_id,
        )
        db.add(affinity)
        db.commit()
        db.refresh(affinity)

    return affinity.to_dict()


@router.get("/characters")
async def get_all_affinities(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户所有角色羁绊"""
    affinities = db.query(CharacterAffinity).filter(
        CharacterAffinity.user_id == current_user.id
    ).order_by(CharacterAffinity.affinity_points.desc()).all()

    return [a.to_dict() for a in affinities]


# ========== 亲密度增加 ==========

@router.post("/characters/{character_id}/add-points")
async def add_affinity_points(
    character_id: str,
    points: int = 1,
    source: str = "chat",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """增加亲密度（内部调用）"""
    affinity = db.query(CharacterAffinity).filter(
        CharacterAffinity.user_id == current_user.id,
        CharacterAffinity.character_id == character_id,
    ).first()

    if not affinity:
        affinity = CharacterAffinity(
            user_id=current_user.id,
            character_id=character_id,
        )
        db.add(affinity)

    affinity.affinity_points += points
    affinity.level = get_level_name(affinity.affinity_points)

    if source == "chat":
        affinity.total_messages += 1
    elif source == "voice":
        affinity.total_voice_seconds += points

    from datetime import datetime
    affinity.last_interaction_at = datetime.utcnow()

    db.commit()
    db.refresh(affinity)

    return affinity.to_dict()


# ========== 用户偏好 ==========

@router.get("/preferences")
async def get_preferences(
    character_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户偏好"""
    query = db.query(UserPreference).filter(
        UserPreference.user_id == current_user.id
    )

    if character_id:
        query = query.filter(
            (UserPreference.character_id == character_id) |
            (UserPreference.character_id == None)
        )

    preferences = query.order_by(UserPreference.importance.desc()).all()
    return [p.to_dict() for p in preferences]


@router.post("/preferences")
async def create_preference(
    req: PreferenceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建用户偏好"""
    preference = UserPreference(
        user_id=current_user.id,
        character_id=req.character_id,
        preference_type=req.preference_type,
        content=req.content,
        importance=req.importance,
        source="manual",
    )
    db.add(preference)
    db.commit()
    db.refresh(preference)
    return preference.to_dict()


@router.delete("/preferences/{preference_id}")
async def delete_preference(
    preference_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除用户偏好"""
    preference = db.query(UserPreference).filter(
        UserPreference.id == preference_id,
        UserPreference.user_id == current_user.id,
    ).first()

    if not preference:
        raise HTTPException(status_code=404, detail="偏好不存在")

    db.delete(preference)
    db.commit()
    return {"message": "删除成功"}


# ========== 聊天时自动增加亲密度 ==========

async def update_affinity_on_chat(user_id: str, character_id: str, db: Session):
    """聊天时自动增加亲密度"""
    affinity = db.query(CharacterAffinity).filter(
        CharacterAffinity.user_id == user_id,
        CharacterAffinity.character_id == character_id,
    ).first()

    if not affinity:
        affinity = CharacterAffinity(
            user_id=user_id,
            character_id=character_id,
        )
        db.add(affinity)

    affinity.affinity_points += 1
    affinity.total_messages += 1

    from datetime import datetime
    affinity.last_interaction_at = datetime.utcnow()

    db.commit()
