import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from ..database import Base


def _id():
    return str(uuid.uuid4())


class Persona(Base):
    __tablename__ = "personas"
    id = Column(String, primary_key=True, default=_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    avatar_url = Column(Text, nullable=True)
    description = Column(Text, nullable=False, default="")
    injection_position = Column(String(20), nullable=False, default="after_char")
    depth = Column(Integer, nullable=False, default=4)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {key: getattr(self, key) for key in ("id", "user_id", "name", "avatar_url", "description", "injection_position", "depth", "is_default")}


class PersonaBinding(Base):
    __tablename__ = "persona_bindings"
    __table_args__ = (
        UniqueConstraint("user_id", "scope_type", "scope_id", name="uq_persona_binding_scope"),
        CheckConstraint("scope_type IN ('character','chat')", name="ck_persona_binding_scope"),
    )
    id = Column(String, primary_key=True, default=_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    persona_id = Column(String, ForeignKey("personas.id"), nullable=False, index=True)
    scope_type = Column(String(20), nullable=False)
    scope_id = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {key: getattr(self, key) for key in ("id", "user_id", "persona_id", "scope_type", "scope_id")}


class PromptPreset(Base):
    __tablename__ = "prompt_presets"
    id = Column(String, primary_key=True, default=_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    token_budget = Column(Integer, nullable=False, default=4096)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {key: getattr(self, key) for key in ("id", "user_id", "name", "token_budget")}


class PromptBlock(Base):
    __tablename__ = "prompt_blocks"
    id = Column(String, primary_key=True, default=_id)
    preset_id = Column(String, ForeignKey("prompt_presets.id"), nullable=False, index=True)
    kind = Column(String(30), nullable=False)
    name = Column(String(120), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    role = Column(String(20), nullable=False, default="system")
    content = Column(Text, nullable=False, default="")
    max_tokens = Column(Integer, nullable=True)

    def to_dict(self):
        return {key: getattr(self, key) for key in ("id", "preset_id", "kind", "name", "enabled", "sort_order", "role", "content", "max_tokens")}


class ModelProfile(Base):
    __tablename__ = "model_profiles"
    id = Column(String, primary_key=True, default=_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    provider = Column(String(80), nullable=False)
    model = Column(String(200), nullable=False)
    parameters = Column(JSON, nullable=False, default=dict)
    prompt_preset_id = Column(String, ForeignKey("prompt_presets.id"), nullable=True)
    stop_sequence_refs = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {key: getattr(self, key) for key in ("id", "user_id", "name", "provider", "model", "parameters", "prompt_preset_id", "stop_sequence_refs")}
