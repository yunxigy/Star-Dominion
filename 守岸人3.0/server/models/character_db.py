# -*- coding: utf-8 -*-
"""角色卡数据库模型"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from ..database import Base
import uuid


class CharacterDB(Base):
    __tablename__ = "characters"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    personality = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=True)
    first_mes = Column(Text, nullable=True)
    mes_example = Column(Text, nullable=True)
    avatar_url = Column(String(500), nullable=True)
    tts_enabled = Column(Boolean, default=True)
    tts_model = Column(String(200), default="mimo-v2.5-tts-voiceclone")
    tts_voice = Column(String(200), default="冰糖")
    tts_style_prompt = Column(Text, nullable=True)
    tts_ref_audio_path = Column(String(500), nullable=True)
    tts_ref_audio_filename = Column(String(200), nullable=True)
    is_nsfw = Column(Boolean, default=False)
    is_public = Column(Boolean, default=True)
    creator_id = Column(String, ForeignKey("users.id"), nullable=True)
    tags = Column(JSON, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        tts = {
            "enabled": self.tts_enabled,
            "model": self.tts_model or "mimo-v2.5-tts-voiceclone",
            "voice": self.tts_voice or "冰糖",
            "ref_audio_path": self.tts_ref_audio_path,
            "ref_audio_filename": self.tts_ref_audio_filename,
            "style_prompt": self.tts_style_prompt,
        }
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "description": self.description,
            "personality": self.personality,
            "system_prompt": self.system_prompt,
            "first_mes": self.first_mes,
            "mes_example": self.mes_example,
            "avatar": self.avatar_url,
            "avatar_url": self.avatar_url,
            "tts": tts,
            "is_nsfw": self.is_nsfw,
            "is_public": self.is_public,
            "creator_id": self.creator_id,
            "tags": self.tags or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
