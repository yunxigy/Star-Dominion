# -*- coding: utf-8 -*-
"""语音会话数据模型"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, JSON, Integer
from sqlalchemy.sql import func
from ..database import Base
import uuid


class VoiceSession(Base):
    """语音会话"""
    __tablename__ = "voice_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(String, nullable=False, index=True)
    session_id = Column(String, nullable=True)  # 关联的文本会话
    status = Column(String(20), default="active")  # active, paused, ended
    total_duration = Column(Integer, default=0)  # 总通话时长（秒）
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "character_id": self.character_id,
            "session_id": self.session_id,
            "status": self.status,
            "total_duration": self.total_duration,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class VoiceMessage(Base):
    """语音消息"""
    __tablename__ = "voice_messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    voice_session_id = Column(String, ForeignKey("voice_sessions.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user, assistant
    text = Column(Text, nullable=True)  # STT识别结果 / AI回复文本
    audio_url = Column(String(500), nullable=True)  # 音频文件路径
    duration_ms = Column(Integer, nullable=True)  # 音频时长
    emotion = Column(String(20), nullable=True)  # 识别到的情绪
    interrupted = Column(Boolean, default=False)  # 是否被打断
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "voice_session_id": self.voice_session_id,
            "role": self.role,
            "text": self.text,
            "audio_url": self.audio_url,
            "duration_ms": self.duration_ms,
            "emotion": self.emotion,
            "interrupted": self.interrupted,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
