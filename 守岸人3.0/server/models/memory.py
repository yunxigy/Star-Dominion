# -*- coding: utf-8 -*-
"""长期记忆数据模型"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, JSON, Float, Integer
from sqlalchemy.sql import func
from ..database import Base
import uuid


class Memory(Base):
    """用户-角色记忆"""
    __tablename__ = "memories"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(String, nullable=False, index=True)
    content = Column(Text, nullable=False)  # 记忆内容
    importance = Column(Float, default=0.5)  # 重要度 0-1
    source = Column(String(50), default="extract")  # 来源：extract/user/manual
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "character_id": self.character_id,
            "content": self.content,
            "importance": self.importance,
            "source": self.source,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MemorySummary(Base):
    """对话摘要"""
    __tablename__ = "memory_summaries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(String, nullable=False, index=True)
    session_id = Column(String, nullable=True)  # 关联的会话
    summary = Column(Text, nullable=False)  # 摘要内容
    message_count = Column(Integer, default=0)  # 摘要包含的消息数
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "character_id": self.character_id,
            "session_id": self.session_id,
            "summary": self.summary,
            "message_count": self.message_count,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
