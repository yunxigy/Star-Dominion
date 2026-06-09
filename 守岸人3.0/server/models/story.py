# -*- coding: utf-8 -*-
"""剧情模型"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, JSON, Float, Integer, UniqueConstraint
from sqlalchemy.sql import func
from ..database import Base
import uuid
import random
import string

def generate_share_code():
    """生成6位分享码"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

class Story(Base):
    """剧情/情景小说"""
    __tablename__ = "stories"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    background = Column(Text, nullable=False)  # 世界背景设定
    task = Column(Text, nullable=False)  # 任务/目标设定
    protagonist = Column(Text, nullable=True)  # 主角设定（可自定义）
    system_prompt = Column(Text, nullable=False)  # AI系统提示词
    cover_url = Column(String(500), nullable=True)
    outline = Column(Text, nullable=True)  # AI生成的大纲
    share_code = Column(String(20), unique=True, nullable=True)  # 分享码
    character_id = Column(String, ForeignKey("characters.id"), nullable=True)  # 关联角色卡
    rating_avg = Column(Float, default=0.0)  # 平均评分
    rating_count = Column(Integer, default=0)  # 评分人数
    is_public = Column(Boolean, default=True)
    is_nsfw = Column(Boolean, default=False)
    creator_id = Column(String, ForeignKey("users.id"), nullable=True)
    tags = Column(JSON, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self, include_details=False):
        data = {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "cover_url": self.cover_url,
            "share_code": self.share_code,
            "character_id": self.character_id,
            "rating_avg": self.rating_avg,
            "rating_count": self.rating_count,
            "is_public": self.is_public,
            "is_nsfw": self.is_nsfw,
            "creator_id": self.creator_id,
            "tags": self.tags or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_details:
            data.update({
                "background": self.background,
                "task": self.task,
                "protagonist": self.protagonist,
                "system_prompt": self.system_prompt,
                "outline": self.outline,
            })
        return data

class StorySession(Base):
    """剧情对话会话"""
    __tablename__ = "story_sessions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    story_id = Column(String, ForeignKey("stories.id"), nullable=False, index=True)
    character_id = Column(String, ForeignKey("characters.id"), nullable=True)  # 代入的角色卡
    protagonist_name = Column(String(100), nullable=True)  # 自定义主角名
    protagonist_desc = Column(Text, nullable=True)  # 自定义主角描述
    current_scene = Column(Text, nullable=True)  # 当前场景描述
    choices_made = Column(JSON, default=[])  # 已做的选择记录
    current_branch_id = Column(String, nullable=True)  # 当前分支节点ID
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "story_id": self.story_id,
            "character_id": self.character_id,
            "protagonist_name": self.protagonist_name,
            "protagonist_desc": self.protagonist_desc,
            "current_scene": self.current_scene,
            "choices_made": self.choices_made or [],
            "current_branch_id": self.current_branch_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class StoryMessage(Base):
    """剧情对话消息"""
    __tablename__ = "story_messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("story_sessions.id"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # narrator / user
    content = Column(Text, nullable=False)
    options = Column(JSON, nullable=True)  # 5个选项
    chosen_option = Column(String(500), nullable=True)  # 用户选择的选项
    branch_id = Column(String, nullable=True)  # 分支节点ID
    parent_branch_id = Column(String, nullable=True)  # 父分支节点ID
    is_checkpoint = Column(Boolean, default=False)  # 是否为存档点
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "role": self.role,
            "content": self.content,
            "options": self.options,
            "chosen_option": self.chosen_option,
            "branch_id": self.branch_id,
            "parent_branch_id": self.parent_branch_id,
            "is_checkpoint": self.is_checkpoint,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class StoryFavorite(Base):
    """剧情收藏"""
    __tablename__ = "story_favorites"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    story_id = Column(String, ForeignKey("stories.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('user_id', 'story_id', name='uq_user_story_favorite'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "story_id": self.story_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class StoryRating(Base):
    """剧情评分"""
    __tablename__ = "story_ratings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    story_id = Column(String, ForeignKey("stories.id"), nullable=False, index=True)
    rating = Column(Integer, nullable=False)  # 1-5
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('user_id', 'story_id', name='uq_user_story_rating'),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "story_id": self.story_id,
            "rating": self.rating,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

class StoryBranch(Base):
    """剧情分支节点"""
    __tablename__ = "story_branches"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("story_sessions.id"), nullable=False, index=True)
    parent_id = Column(String, nullable=True)  # 父节点ID
    content = Column(Text, nullable=True)  # 该节点的剧情内容摘要
    choice_text = Column(Text, nullable=True)  # 导致此分支的选项文本
    depth = Column(Integer, default=0)  # 深度
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "session_id": self.session_id,
            "parent_id": self.parent_id,
            "content": self.content[:100] if self.content else None,  # 截断摘要
            "choice_text": self.choice_text,
            "depth": self.depth,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
