# -*- coding: utf-8 -*-
"""Lorebook（世界书）路由"""
from dataclasses import asdict
import random

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Literal, Optional
from ..database import get_db
from ..models.user import User
from ..models.chat_db import ChatSession
from ..models.lorebook import Lorebook, LorebookBinding, LorebookEntry
from ..middleware.auth import get_current_user
from ..services.resource_access import (
    require_editable_character,
    require_editable_lorebook,
    require_editable_lorebook_entry,
    require_readable_character,
    require_readable_lorebook,
)
from ..services.chat_history import ChatResourceNotFound
from ..services.lorebook_runtime import LorebookRuntime

router = APIRouter(prefix="/api/lorebooks", tags=["lorebooks"])


class LorebookCreate(BaseModel):
    character_id: str
    name: str
    description: Optional[str] = ""
    is_character_default: bool = True

class LorebookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_enabled: Optional[bool] = None
    scan_depth: Optional[int] = Field(default=None, ge=0)
    is_character_default: Optional[bool] = None
    token_budget: Optional[int] = Field(default=None, ge=64, le=65536)
    recursive_scan: Optional[bool] = None
    max_recursion_steps: Optional[int] = Field(default=None, ge=1, le=20)

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
    sticky: int = Field(default=0, ge=0, le=10000)
    delay: int = Field(default=0, ge=0, le=10000)
    group: Optional[str] = None
    group_weight: int = Field(default=100, ge=0)
    case_sensitive: Optional[bool] = False
    match_whole_words: Optional[bool] = False
    exclude_recursion: Optional[bool] = False
    prevent_recursion: bool = False
    recursion_only: bool = False
    group_prioritized: bool = False
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
    sticky: Optional[int] = Field(default=None, ge=0, le=10000)
    delay: Optional[int] = Field(default=None, ge=0, le=10000)
    group: Optional[str] = None
    group_weight: Optional[int] = Field(default=None, ge=0)
    case_sensitive: Optional[bool] = None
    match_whole_words: Optional[bool] = None
    exclude_recursion: Optional[bool] = None
    prevent_recursion: Optional[bool] = None
    recursion_only: Optional[bool] = None
    group_prioritized: Optional[bool] = None
    comment: Optional[str] = None


class LorebookDebugRequest(BaseModel):
    session_id: str
    text: str = Field(min_length=1, max_length=20000)


class LorebookBindingsUpdate(BaseModel):
    chat_session_ids: list[str] = Field(default_factory=list, max_length=100)


# ========== Lorebook 管理 ==========

@router.post("/debug")
async def debug_lorebook(
    req: LorebookDebugRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    runtime = LorebookRuntime(
        db,
        owner_id=current_user.id,
        random_value=random.random,
    )
    try:
        evaluation = runtime.evaluate(req.session_id, current_input=req.text)
    except ChatResourceNotFound as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc
    return {
        "activated_ids": evaluation.activated_ids,
        "used_tokens": evaluation.used_tokens,
        "entries": evaluation.prompt_entries(),
        "trace": [asdict(item) for item in evaluation.trace],
    }

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
        is_character_default=req.is_character_default,
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

    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(lorebook, field, value)

    db.commit()
    db.refresh(lorebook)
    return lorebook.to_dict()


@router.get("/{lorebook_id}/bindings")
async def get_lorebook_bindings(
    lorebook_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_editable_lorebook(db, current_user, lorebook_id)
    ids = db.scalars(
        select(LorebookBinding.scope_id).where(
            LorebookBinding.lorebook_id == lorebook_id,
            LorebookBinding.scope_type == "chat",
        ).order_by(LorebookBinding.scope_id)
    ).all()
    return {"chat_session_ids": list(ids)}


@router.put("/{lorebook_id}/bindings")
async def replace_lorebook_bindings(
    lorebook_id: str,
    req: LorebookBindingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    lorebook = require_editable_lorebook(db, current_user, lorebook_id)
    requested = req.chat_session_ids
    if len(requested) != len(set(requested)):
        raise HTTPException(status_code=422, detail="会话绑定不能重复")
    sessions = db.scalars(
        select(ChatSession).where(
            ChatSession.id.in_(requested),
            ChatSession.user_id == current_user.id,
            ChatSession.character_id == lorebook.character_id,
        )
    ).all() if requested else []
    if len(sessions) != len(requested):
        raise HTTPException(status_code=404, detail="会话不存在")
    db.query(LorebookBinding).filter(
        LorebookBinding.lorebook_id == lorebook.id,
        LorebookBinding.scope_type == "chat",
    ).delete(synchronize_session=False)
    db.add_all([
        LorebookBinding(
            lorebook_id=lorebook.id,
            scope_type="chat",
            scope_id=session_id,
        )
        for session_id in requested
    ])
    db.commit()
    return {"chat_session_ids": sorted(requested)}


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
        sticky=req.sticky,
        delay=req.delay,
        group=req.group,
        group_weight=req.group_weight,
        case_sensitive=req.case_sensitive,
        match_whole_words=req.match_whole_words,
        exclude_recursion=req.exclude_recursion,
        prevent_recursion=req.prevent_recursion,
        recursion_only=req.recursion_only,
        group_prioritized=req.group_prioritized,
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

    supplied = req.model_dump(exclude_unset=True)
    prompt_fields = {
        "keyword", "content", "secondary_keyword", "selective_logic", "priority",
        "is_enabled", "constant", "position", "depth", "order", "probability",
        "cooldown", "sticky", "delay", "group", "group_weight",
        "case_sensitive", "match_whole_words", "exclude_recursion",
        "prevent_recursion", "recursion_only", "group_prioritized",
    }
    changed = any(
        field in prompt_fields and getattr(entry, field) != value
        for field, value in supplied.items()
    )
    for field, value in supplied.items():
        setattr(entry, field, value)
    if changed:
        entry.revision = (entry.revision or 1) + 1

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
