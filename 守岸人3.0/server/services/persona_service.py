from dataclasses import dataclass
from typing import Literal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models.character_db import CharacterDB
from ..models.chat_db import ChatSession
from ..models.persona import Persona, PersonaBinding


class PersonaNotFound(LookupError):
    pass


@dataclass(frozen=True)
class PersonaSelection:
    persona: Persona | None
    source: Literal["temporary", "chat", "character", "default", "none"]


class PersonaService:
    def __init__(self, db: Session, *, owner_id: str):
        self.db = db
        self.owner_id = owner_id

    def owned_persona(self, persona_id: str) -> Persona:
        persona = self.db.scalar(select(Persona).where(Persona.id == persona_id, Persona.user_id == self.owner_id))
        if persona is None:
            raise PersonaNotFound("persona not found")
        return persona

    def list_personas(self) -> list[Persona]:
        return list(self.db.scalars(select(Persona).where(Persona.user_id == self.owner_id).order_by(Persona.name, Persona.id)))

    def binding(self, scope_type: str, scope_id: str) -> PersonaBinding | None:
        return self.db.scalar(select(PersonaBinding).where(PersonaBinding.user_id == self.owner_id, PersonaBinding.scope_type == scope_type, PersonaBinding.scope_id == scope_id))

    def clear_binding(self, scope_type: str, scope_id: str) -> None:
        binding = self.binding(scope_type, scope_id)
        if binding is not None:
            self.db.delete(binding)
            self.db.commit()

    def set_default(self, persona_id: str) -> Persona:
        persona = self.owned_persona(persona_id)
        self.db.query(Persona).filter(Persona.user_id == self.owner_id).update({Persona.is_default: False}, synchronize_session=False)
        persona.is_default = True
        self.db.commit(); self.db.refresh(persona)
        return persona

    def bind(self, persona_id: str, scope_type: str, scope_id: str) -> PersonaBinding:
        persona = self.owned_persona(persona_id)
        if scope_type == "chat":
            resource = self.db.scalar(select(ChatSession).where(ChatSession.id == scope_id, ChatSession.user_id == self.owner_id))
        elif scope_type == "character":
            resource = self.db.scalar(select(CharacterDB).where(CharacterDB.id == scope_id, or_(CharacterDB.user_id == self.owner_id, CharacterDB.is_public.is_(True))))
        else:
            raise PersonaNotFound("binding scope not found")
        if resource is None:
            raise PersonaNotFound("binding scope not found")
        binding = self.binding(scope_type, scope_id)
        if binding is None:
            binding = PersonaBinding(user_id=self.owner_id, persona_id=persona.id, scope_type=scope_type, scope_id=scope_id)
            self.db.add(binding)
        else:
            binding.persona_id = persona.id
        self.db.commit(); self.db.refresh(binding)
        return binding

    def select(self, *, character_id: str, session_id: str, temporary_persona_id: str | None = None) -> PersonaSelection:
        session = self.db.scalar(select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == self.owner_id, ChatSession.character_id == character_id))
        if session is None:
            raise PersonaNotFound("chat session not found")
        if temporary_persona_id:
            return PersonaSelection(self.owned_persona(temporary_persona_id), "temporary")
        for source, scope_type, scope_id in (("chat", "chat", session_id), ("character", "character", character_id)):
            binding = self.binding(scope_type, scope_id)
            if binding is not None:
                return PersonaSelection(self.owned_persona(binding.persona_id), source)
        default = self.db.scalar(select(Persona).where(Persona.user_id == self.owner_id, Persona.is_default.is_(True)).order_by(Persona.id))
        return PersonaSelection(default, "default" if default is not None else "none")
