# -*- coding: utf-8 -*-
"""对话历史数据库模型"""
from sqlalchemy import Column, String, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from ..database import Base
import uuid

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(String, ForeignKey("characters.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "character_id": self.character_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user / assistant / system
    content = Column(JSON, nullable=False)  # {text: "", audio_url: "", image_url: ""}
    swipes = Column(JSON, nullable=True)  # [text1, text2, ...] 多候选回复
    swipe_id = Column(String, nullable=True, default="0")  # 当前选中的 swipe 索引
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "role": self.role,
            "content": self.content,
            "swipes": self.swipes or [self.content.get("text", "")] if self.content else [],
            "swipe_id": int(self.swipe_id) if self.swipe_id else 0,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
