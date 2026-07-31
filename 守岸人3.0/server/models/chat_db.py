# -*- coding: utf-8 -*-
"""对话历史数据库模型"""
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from ..database import Base
import uuid

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(String, ForeignKey("characters.id"), nullable=False, index=True)
    current_branch_id = Column(String, nullable=True, index=True)
    head_message_id = Column(String, nullable=True)
    title = Column(String(120), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "character_id": self.character_id,
            "current_branch_id": self.current_branch_id,
            "head_message_id": self.head_message_id,
            "title": self.title,
            "version": self.version,
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
    branch_id = Column(String, ForeignKey("chat_branches.id"), nullable=False, index=True)
    parent_message_id = Column(String, ForeignKey("chat_messages.id"), nullable=True, index=True)
    sequence = Column(Integer, nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "role": self.role,
            "content": self.content,
            "swipes": self.swipes or [self.content.get("text", "")] if self.content else [],
            "swipe_id": int(self.swipe_id) if self.swipe_id else 0,
            "branch_id": self.branch_id,
            "parent_message_id": self.parent_message_id,
            "sequence": self.sequence,
            "edited_at": self.edited_at.isoformat() if self.edited_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class ChatBranch(Base):
    __tablename__ = "chat_branches"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    parent_branch_id = Column(String, ForeignKey("chat_branches.id"), nullable=True)
    fork_message_id = Column(String, ForeignKey("chat_messages.id"), nullable=True)
    head_message_id = Column(String, ForeignKey("chat_messages.id"), nullable=True)
    name = Column(String(120), nullable=False, default="主分支")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ChatCheckpoint(Base):
    __tablename__ = "chat_checkpoints"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    branch_id = Column(String, ForeignKey("chat_branches.id"), nullable=False)
    message_id = Column(String, ForeignKey("chat_messages.id"), nullable=True)
    name = Column(String(120), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
