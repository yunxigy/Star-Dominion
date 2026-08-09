# -*- coding: utf-8 -*-
"""Lorebook（世界书）路由"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Literal, Optional
from ..database import get_db
from ..models.user import User
from ..models.lorebook import Lorebook, LorebookEntry
from ..middleware.auth import get_current_user
from ..services.resource_access import (
    require_editable_character,
    require_editable_lorebook,
    require_editable_lorebook_entry,
    require_readable_character,
    require_readable_lorebook,
)

router = APIRouter(prefix="/api/lorebooks", tags=["lorebooks"])


class LorebookCreate(BaseModel):
    character_id: str
    name: str
    description: Optional[str] = ""

class LorebookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_enabled: Optional[bool] = None
    scan_depth: Optional[int] = Field(default=None, ge=0)

class EntryCreate(BaseModel):
    keyword: str
    content: str
    secondary_keyword: Optional[str] = None
    selective_logic: Literal["and", "or"] = "or"
    priority: Optional[int] = 0
    constant: Optional[bool] = False
    position: Literal["before_char", "after_char", "depth"] = "after_char"
    depth: int = Field(default=4, ge=0)
    order: Optional[int] = 0
    probability: float = Field(default=1.0, ge=0.0, le=1.0)
    cooldown: int = Field(default=0, ge=0)
    group: Optional[str] = None
    group_weight: int = Field(default=100, ge=0)
    case_sensitive: Optional[bool] = False
    match_whole_words: Optional[bool] = False
    exclude_recursion: Optional[bool] = False
    comment: Optional[str] = None

class EntryUpdate(BaseModel):
    keyword: Optional[str] = None
    content: Optional[str] = None
    secondary_keyword: Optional[str] = None
    selective_logic: Optional[Literal["and", "or"]] = None
    priority: Optional[int] = None
    is_enabled: Optional[bool] = None
    constant: Optional[bool] = None
    position: Optional[Literal["before_char", "after_char", "depth"]] = None
    depth: Optional[int] = Field(default=None, ge=0)
    order: Optional[int] = None
    probability: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    cooldown: Optional[int] = Field(default=None, ge=0)
    group: Optional[str] = None
    group_weight: Optional[int] = Field(default=None, ge=0)
    case_sensitive: Optional[bool] = None
    match_whole_words: Optional[bool] = None
    exclude_recursion: Optional[bool] = None
    comment: Optional[str] = None


# ========== Lorebook 管理 ==========

@router.get("/character/{character_id}")
async def get_character_lorebooks(
    character_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取角色的所有 Lorebook"""
    require_readable_character(db, current_user, character_id)
    lorebooks = db.query(Lorebook).filter(
        Lorebook.character_id == character_id
    ).all()
    return [l.to_dict() for l in lorebooks]


@router.post("")
async def create_lorebook(
    req: LorebookCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建 Lorebook"""
    require_editable_character(db, current_user, req.character_id)
    lorebook = Lorebook(
        character_id=req.character_id,
        name=req.name,
        description=req.description,
    )
    db.add(lorebook)
    db.commit()
    db.refresh(lorebook)
    return lorebook.to_dict()


@router.put("/{lorebook_id}")
async def update_lorebook(
    lorebook_id: str,
    req: LorebookUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新 Lorebook"""
    lorebook = require_editable_lorebook(db, current_user, lorebook_id)

    if req.name is not None:
        lorebook.name = req.name
    if req.description is not None:
        lorebook.description = req.description
    if req.is_enabled is not None:
        lorebook.is_enabled = req.is_enabled
    if req.scan_depth is not None:
        lorebook.scan_depth = req.scan_depth

    db.commit()
    db.refresh(lorebook)
    return lorebook.to_dict()


@router.delete("/{lorebook_id}")
async def delete_lorebook(
    lorebook_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除 Lorebook"""
    lorebook = require_editable_lorebook(db, current_user, lorebook_id)

    # 删除所有条目
    db.query(LorebookEntry).filter(LorebookEntry.lorebook_id == lorebook_id).delete()
    db.delete(lorebook)
    db.commit()

    return {"message": "删除成功"}


# ========== 条目管理 ==========

@router.get("/{lorebook_id}/entries")
async def get_entries(
    lorebook_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取 Lorebook 的所有条目"""
    require_readable_lorebook(db, current_user, lorebook_id)
    entries = db.query(LorebookEntry).filter(
        LorebookEntry.lorebook_id == lorebook_id
    ).order_by(
        LorebookEntry.priority.desc(),
        LorebookEntry.order.asc(),
        LorebookEntry.id.asc(),
    ).all()
    return [e.to_dict() for e in entries]


@router.post("/{lorebook_id}/entries")
async def create_entry(
    lorebook_id: str,
    req: EntryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建条目"""
    require_editable_lorebook(db, current_user, lorebook_id)

    entry = LorebookEntry(
        lorebook_id=lorebook_id,
        keyword=req.keyword,
        content=req.content,
        secondary_keyword=req.secondary_keyword,
        selective_logic=req.selective_logic,
        priority=req.priority,
        constant=req.constant,
        position=req.position,
        depth=req.depth,
        order=req.order,
        probability=req.probability,
        cooldown=req.cooldown,
        group=req.group,
        group_weight=req.group_weight,
        case_sensitive=req.case_sensitive,
        match_whole_words=req.match_whole_words,
        exclude_recursion=req.exclude_recursion,
        comment=req.comment,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry.to_dict()


@router.put("/entries/{entry_id}")
async def update_entry(
    entry_id: str,
    req: EntryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新条目"""
    entry = require_editable_lorebook_entry(db, current_user, entry_id)

    if req.keyword is not None:
        entry.keyword = req.keyword
    if req.content is not None:
        entry.content = req.content
    if req.secondary_keyword is not None:
        entry.secondary_keyword = req.secondary_keyword
    if req.selective_logic is not None:
        entry.selective_logic = req.selective_logic
    if req.priority is not None:
        entry.priority = req.priority
    if req.is_enabled is not None:
        entry.is_enabled = req.is_enabled
    if req.constant is not None:
        entry.constant = req.constant
    if req.position is not None:
        entry.position = req.position
    if req.depth is not None:
        entry.depth = req.depth
    if req.order is not None:
        entry.order = req.order
    if req.probability is not None:
        entry.probability = req.probability
    if req.cooldown is not None:
        entry.cooldown = req.cooldown
    if req.group is not None:
        entry.group = req.group
    if req.group_weight is not None:
        entry.group_weight = req.group_weight
    if req.case_sensitive is not None:
        entry.case_sensitive = req.case_sensitive
    if req.match_whole_words is not None:
        entry.match_whole_words = req.match_whole_words
    if req.exclude_recursion is not None:
        entry.exclude_recursion = req.exclude_recursion
    if req.comment is not None:
        entry.comment = req.comment

    db.commit()
    db.refresh(entry)
    return entry.to_dict()


@router.delete("/entries/{entry_id}")
async def delete_entry(
    entry_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除条目"""
    entry = require_editable_lorebook_entry(db, current_user, entry_id)

    db.delete(entry)
    db.commit()

    return {"message": "删除成功"}
