from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.chat_db import ChatSession
from ..models.persona import Persona, PersonaBinding
from ..models.user import User
from ..services.persona_service import PersonaNotFound, PersonaService

router = APIRouter(prefix="/api/personas", tags=["personas"])


class PersonaPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    avatar_url: str | None = Field(default=None, max_length=2000)
    description: str = Field(default="", max_length=20000)
    injection_position: Literal["before_char", "after_char", "depth"] = "after_char"
    depth: int = Field(default=4, ge=0, le=100)


class BindingPayload(BaseModel):
    persona_id: str


def _service(db, user):
    return PersonaService(db, owner_id=user.id)


@router.get("")
def list_personas(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [item.to_dict() for item in _service(db, current_user).list_personas()]


@router.post("")
def create_persona(payload: PersonaPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = Persona(user_id=current_user.id, **payload.model_dump())
    db.add(item); db.commit(); db.refresh(item)
    return item.to_dict()


@router.put("/{persona_id}")
def update_persona(persona_id: str, payload: PersonaPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        item = _service(db, current_user).owned_persona(persona_id)
    except PersonaNotFound as exc:
        raise HTTPException(404, "Persona 不存在") from exc
    for key, value in payload.model_dump().items(): setattr(item, key, value)
    db.commit(); db.refresh(item)
    return item.to_dict()


@router.delete("/{persona_id}")
def delete_persona(persona_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        item = _service(db, current_user).owned_persona(persona_id)
    except PersonaNotFound as exc:
        raise HTTPException(404, "Persona 不存在") from exc
    db.query(PersonaBinding).filter(PersonaBinding.user_id == current_user.id, PersonaBinding.persona_id == item.id).delete(synchronize_session=False)
    db.delete(item); db.commit()
    return {"status": "ok"}


@router.put("/default/{persona_id}")
def set_default(persona_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try: item = _service(db, current_user).set_default(persona_id)
    except PersonaNotFound as exc: raise HTTPException(404, "Persona 不存在") from exc
    return item.to_dict()


@router.put("/bindings/{scope_type}/{scope_id}")
def bind_persona(scope_type: Literal["character", "chat"], scope_id: str, payload: BindingPayload, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try: item = _service(db, current_user).bind(payload.persona_id, scope_type, scope_id)
    except PersonaNotFound as exc: raise HTTPException(404, "资源不存在") from exc
    return item.to_dict()


@router.delete("/bindings/{scope_type}/{scope_id}")
def clear_binding(scope_type: Literal["character", "chat"], scope_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _service(db, current_user).clear_binding(scope_type, scope_id)
    return {"status": "ok"}


@router.get("/selection")
def get_selection(session_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.scalar(select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == current_user.id))
    if session is None: raise HTTPException(404, "会话不存在")
    try: selected = _service(db, current_user).select(character_id=session.character_id, session_id=session.id)
    except PersonaNotFound as exc: raise HTTPException(404, "会话不存在") from exc
    return {"persona": selected.persona.to_dict() if selected.persona else None, "source": selected.source}
