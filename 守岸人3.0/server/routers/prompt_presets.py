from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.persona import ModelProfile, PromptBlock, PromptPreset
from ..models.user import User
from ..services.prompt_composer import PromptBlockInput, PromptComposer

router = APIRouter(prefix="/api/prompt-presets", tags=["prompt-presets"])
profiles_router = APIRouter(prefix="/api/model-profiles", tags=["model-profiles"])

BlockKind = Literal[
    "system", "character", "persona", "lorebook", "memory", "rag",
    "author_note", "history", "final",
]
ALLOWED_PARAMETERS = {
    "temperature", "top_p", "max_tokens", "frequency_penalty", "presence_penalty",
}


class PresetPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    token_budget: int = Field(default=4096, ge=64, le=65536)


class BlockPayload(BaseModel):
    kind: BlockKind
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    sort_order: int = Field(default=0, ge=-10000, le=10000)
    role: Literal["system", "user", "assistant"] = "system"
    content: str = Field(default="", max_length=100000)
    max_tokens: int | None = Field(default=None, ge=1, le=65536)


class ReorderPayload(BaseModel):
    block_ids: list[str] = Field(min_length=1, max_length=500)


class ProfilePayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=200)
    parameters: dict = Field(default_factory=dict)
    prompt_preset_id: str | None = None
    stop_sequence_refs: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("parameters")
    @classmethod
    def validate_parameters(cls, value):
        unknown = set(value) - ALLOWED_PARAMETERS
        if unknown:
            raise ValueError(f"unsupported model parameters: {sorted(unknown)}")
        return value


class PreviewPayload(BaseModel):
    preset_id: str
    metadata: dict = Field(default_factory=dict)


def owned_preset(db: Session, user_id: str, preset_id: str) -> PromptPreset:
    item = db.scalar(select(PromptPreset).where(PromptPreset.id == preset_id, PromptPreset.user_id == user_id))
    if item is None:
        raise HTTPException(404, "Prompt 预设不存在")
    return item


def owned_block(db: Session, user_id: str, block_id: str) -> PromptBlock:
    item = db.scalar(
        select(PromptBlock)
        .join(PromptPreset, PromptPreset.id == PromptBlock.preset_id)
        .where(PromptBlock.id == block_id, PromptPreset.user_id == user_id)
    )
    if item is None:
        raise HTTPException(404, "Prompt 块不存在")
    return item


def owned_profile(db: Session, user_id: str, profile_id: str) -> ModelProfile:
    item = db.scalar(select(ModelProfile).where(ModelProfile.id == profile_id, ModelProfile.user_id == user_id))
    if item is None:
        raise HTTPException(404, "模型档案不存在")
    return item


@router.get("")
def list_presets(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(PromptPreset).where(PromptPreset.user_id == current_user.id).order_by(PromptPreset.name, PromptPreset.id))
    return [row.to_dict() for row in rows]


@router.post("")
def create_preset(payload: PresetPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = PromptPreset(user_id=current_user.id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item.to_dict()


@router.post("/preview")
def preview_preset(payload: PreviewPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    preset = owned_preset(db, current_user.id, payload.preset_id)
    rows = db.scalars(select(PromptBlock).where(PromptBlock.preset_id == preset.id).order_by(PromptBlock.sort_order, PromptBlock.id)).all()
    blocks = [PromptBlockInput(row.id, row.kind, row.content, row.sort_order, row.role, row.enabled) for row in rows]
    result = PromptComposer().preview(blocks=blocks, token_budget=preset.token_budget, metadata=payload.metadata)
    return {
        "included": [asdict(item) for item in result.included],
        "trace": [asdict(item) for item in result.trace],
        "used_tokens": result.used_tokens,
        "metadata": result.metadata,
    }


@router.get("/{preset_id}")
def get_preset(preset_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return owned_preset(db, current_user.id, preset_id).to_dict()


@router.put("/{preset_id}")
def update_preset(preset_id: str, payload: PresetPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = owned_preset(db, current_user.id, preset_id)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item.to_dict()


@router.delete("/{preset_id}")
def delete_preset(preset_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = owned_preset(db, current_user.id, preset_id)
    db.query(PromptBlock).filter(PromptBlock.preset_id == item.id).delete(synchronize_session=False)
    db.query(ModelProfile).filter(ModelProfile.user_id == current_user.id, ModelProfile.prompt_preset_id == item.id).update({ModelProfile.prompt_preset_id: None}, synchronize_session=False)
    db.delete(item)
    db.commit()
    return {"status": "ok"}


@router.get("/{preset_id}/blocks")
def list_blocks(preset_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    preset = owned_preset(db, current_user.id, preset_id)
    rows = db.scalars(select(PromptBlock).where(PromptBlock.preset_id == preset.id).order_by(PromptBlock.sort_order, PromptBlock.id))
    return [row.to_dict() for row in rows]


@router.post("/{preset_id}/blocks")
def create_block(preset_id: str, payload: BlockPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    preset = owned_preset(db, current_user.id, preset_id)
    item = PromptBlock(preset_id=preset.id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item.to_dict()


@router.put("/{preset_id}/blocks/reorder")
def reorder_blocks(preset_id: str, payload: ReorderPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    preset = owned_preset(db, current_user.id, preset_id)
    if len(payload.block_ids) != len(set(payload.block_ids)):
        raise HTTPException(422, "Prompt 块不能重复")
    rows = db.scalars(select(PromptBlock).where(PromptBlock.preset_id == preset.id, PromptBlock.id.in_(payload.block_ids))).all()
    if len(rows) != len(payload.block_ids):
        raise HTTPException(404, "Prompt 块不存在")
    by_id = {row.id: row for row in rows}
    for order, block_id in enumerate(payload.block_ids):
        by_id[block_id].sort_order = order
    db.commit()
    return {"items": [by_id[block_id].to_dict() for block_id in payload.block_ids]}


@router.put("/blocks/{block_id}")
def update_block(block_id: str, payload: BlockPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = owned_block(db, current_user.id, block_id)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item.to_dict()


@router.delete("/blocks/{block_id}")
def delete_block(block_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = owned_block(db, current_user.id, block_id)
    db.delete(item)
    db.commit()
    return {"status": "ok"}


@profiles_router.get("")
def list_profiles(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(ModelProfile).where(ModelProfile.user_id == current_user.id).order_by(ModelProfile.name, ModelProfile.id))
    return [row.to_dict() for row in rows]


@profiles_router.post("")
def create_profile(payload: ProfilePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.prompt_preset_id:
        owned_preset(db, current_user.id, payload.prompt_preset_id)
    item = ModelProfile(user_id=current_user.id, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item.to_dict()


@profiles_router.put("/{profile_id}")
def update_profile(profile_id: str, payload: ProfilePayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = owned_profile(db, current_user.id, profile_id)
    if payload.prompt_preset_id:
        owned_preset(db, current_user.id, payload.prompt_preset_id)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item.to_dict()


@profiles_router.delete("/{profile_id}")
def delete_profile(profile_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = owned_profile(db, current_user.id, profile_id)
    db.delete(item)
    db.commit()
    return {"status": "ok"}
