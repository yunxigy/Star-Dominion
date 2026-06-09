# -*- coding: utf-8 -*-
"""角色羁绊系统数据模型"""
from sqlalchemy import Column, String, Text, Integer, Float, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from ..database import Base
import uuid


class CharacterAffinity(Base):
    """角色羁绊"""
    __tablename__ = "character_affinities"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(String, nullable=False, index=True)
    level = Column(Integer, default=0)  # 羁绊等级 0-100
    affinity_points = Column(Integer, default=0)  # 亲密度积分
    total_messages = Column(Integer, default=0)  # 总对话次数
    total_voice_seconds = Column(Integer, default=0)  # 总语音时长（秒）
    last_interaction_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "character_id": self.character_id,
            "level": self.level,
            "level_name": get_level_name(self.level),
            "affinity_points": self.affinity_points,
            "total_messages": self.total_messages,
            "total_voice_seconds": self.total_voice_seconds,
            "last_interaction_at": self.last_interaction_at.isoformat() if self.last_interaction_at else None,
        }


class UserPreference(Base):
    """用户偏好记忆"""
    __tablename__ = "user_preferences"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    character_id = Column(String, nullable=True, index=True)  # null表示全局偏好
    preference_type = Column(String(50), nullable=False)  # name, hobby, event, dislike, custom
    content = Column(Text, nullable=False)
    importance = Column(Integer, default=5)  # 1-10
    source = Column(String(50), default="extract")  # extract, manual
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "character_id": self.character_id,
            "preference_type": self.preference_type,
            "content": self.content,
            "importance": self.importance,
            "source": self.source,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


# 羁绊等级定义
AFFINITY_LEVELS = [
    (0, "陌生"),
    (10, "相识"),
    (25, "熟悉"),
    (50, "信赖"),
    (75, "亲密"),
    (100, "专属"),
]

def get_level_name(points: int) -> str:
    """获取羁绊等级名称"""
    for threshold, name in reversed(AFFINITY_LEVELS):
        if points >= threshold:
            return name
    return "陌生"

def get_next_level(points: int) -> tuple:
    """获取下一等级信息"""
    for threshold, name in AFFINITY_LEVELS:
        if points < threshold:
            return threshold, name
    return 100, "专属"
