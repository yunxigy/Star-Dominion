# -*- coding: utf-8 -*-
"""群聊数据模型"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, JSON, Integer
from sqlalchemy.sql import func
from ..database import Base
import uuid


class GroupSession(Base):
    """群聊会话"""
    __tablename__ = "group_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    avatar_url = Column(String(500), nullable=True)
    turn_order = Column(String(20), default="round_robin")  # round_robin, random, triggered, user_pick
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "name": self.name,
            "description": self.description,
            "avatar_url": self.avatar_url,
            "turn_order": self.turn_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class GroupMember(Base):
    """群聊成员"""
    __tablename__ = "group_members"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id = Column(String, ForeignKey("group_sessions.id"), nullable=False, index=True)
    character_id = Column(String, nullable=False, index=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "group_id": self.group_id,
            "character_id": self.character_id,
            "sort_order": self.sort_order,
            "is_active": self.is_active,
            "joined_at": self.joined_at.isoformat() if self.joined_at else None,
        }


class GroupMessage(Base):
    """群聊消息"""
    __tablename__ = "group_messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    group_id = Column(String, ForeignKey("group_sessions.id"), nullable=False, index=True)
    character_id = Column(String, nullable=True)  # 角色发言时填写，用户发言时为null
    role = Column(String(20), nullable=False)  # user, character, system
    content = Column(JSON, nullable=False)  # {text: "", audio_url: "", mentions: ["char_id"]}
    turn_index = Column(Integer, default=0)  # 本轮第几个发言
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "group_id": self.group_id,
            "character_id": self.character_id,
            "role": self.role,
            "content": self.content,
            "turn_index": self.turn_index,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
