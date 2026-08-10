# -*- coding: utf-8 -*-
"""Lorebook（世界书）数据模型 - 增强版"""
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from ..database import Base
import uuid


class Lorebook(Base):
    """Lorebook 世界书"""
    __tablename__ = "lorebooks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    character_id = Column(String, ForeignKey("characters.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    is_enabled = Column(Boolean, default=True)
    scan_depth = Column(Integer, default=2)  # 扫描最近 N 条消息
    is_character_default = Column(Boolean, default=True, nullable=False)
    token_budget = Column(Integer, default=1024, nullable=False)
    recursive_scan = Column(Boolean, default=True, nullable=False)
    max_recursion_steps = Column(Integer, default=3, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "character_id": self.character_id,
            "name": self.name,
            "description": self.description,
            "is_enabled": self.is_enabled,
            "scan_depth": self.scan_depth,
            "is_character_default": self.is_character_default,
            "token_budget": self.token_budget,
            "recursive_scan": self.recursive_scan,
            "max_recursion_steps": self.max_recursion_steps,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class LorebookEntry(Base):
    """Lorebook 条目 - 增强版"""
    __tablename__ = "lorebook_entries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lorebook_id = Column(String, ForeignKey("lorebooks.id"), nullable=False, index=True)

    # 关键词匹配
    keyword = Column(String(500), nullable=False)  # 主关键词（逗号分隔支持多关键词）
    secondary_keyword = Column(String(500), nullable=True)  # 次要关键词（选择性匹配）
    selective_logic = Column(String(10), default="or")  # and / or - 主要和次要关键词的逻辑关系

    # 注入控制
    content = Column(Text, nullable=False)  # 注入的内容
    is_enabled = Column(Boolean, default=True)
    constant = Column(Boolean, default=False)  # 始终注入（不依赖关键词）
    position = Column(String(20), default="after_char")  # before_char / after_char / depth
    depth = Column(Integer, default=4)  # 深度注入位置（position=depth 时生效）
    order = Column(Integer, default=0)  # 同位置排序权重
    priority = Column(Integer, default=0, nullable=False)  # 跨位置的触发优先级

    # 高级控制
    probability = Column(Float, default=1.0)  # 触发概率 0.0-1.0
    cooldown = Column(Integer, default=0)  # 冷却时间（N 条消息后才能再次触发）
    sticky = Column(Integer, default=0, nullable=False)
    delay = Column(Integer, default=0, nullable=False)
    group = Column(String(50), nullable=True)  # 分组名（同组条目按权重选择）
    group_weight = Column(Integer, default=100)  # 分组内权重

    # 匹配选项
    case_sensitive = Column(Boolean, default=False)  # 大小写敏感
    match_whole_words = Column(Boolean, default=False)  # 全词匹配
    exclude_recursion = Column(Boolean, default=False)  # 排除递归触发
    prevent_recursion = Column(Boolean, default=False, nullable=False)
    recursion_only = Column(Boolean, default=False, nullable=False)
    group_prioritized = Column(Boolean, default=False, nullable=False)
    revision = Column(Integer, default=1, nullable=False)

    # 元数据
    comment = Column(String(200), nullable=True)  # 备注
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "lorebook_id": self.lorebook_id,
            "keyword": self.keyword,
            "secondary_keyword": self.secondary_keyword,
            "selective_logic": self.selective_logic,
            "content": self.content,
            "is_enabled": self.is_enabled,
            "constant": self.constant,
            "position": self.position,
            "depth": self.depth,
            "order": self.order,
            "priority": self.priority,
            "probability": self.probability,
            "cooldown": self.cooldown,
            "sticky": self.sticky,
            "delay": self.delay,
            "group": self.group,
            "group_weight": self.group_weight,
            "case_sensitive": self.case_sensitive,
            "match_whole_words": self.match_whole_words,
            "exclude_recursion": self.exclude_recursion,
            "prevent_recursion": self.prevent_recursion,
            "recursion_only": self.recursion_only,
            "group_prioritized": self.group_prioritized,
            "revision": self.revision,
            "comment": self.comment,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class LorebookBinding(Base):
    """Apply a lorebook to an additional owned resource scope."""

    __tablename__ = "lorebook_bindings"
    __table_args__ = (
        UniqueConstraint(
            "lorebook_id",
            "scope_type",
            "scope_id",
            name="uq_lorebook_binding_scope",
        ),
        CheckConstraint(
            "scope_type IN ('character', 'chat', 'persona')",
            name="ck_lorebook_binding_scope_type",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lorebook_id = Column(String, nullable=False, index=True)
    scope_type = Column(String(20), nullable=False, index=True)
    scope_id = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LorebookActivationEvent(Base):
    """Timed lorebook activation attached to an assistant response path."""

    __tablename__ = "lorebook_activation_events"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "response_message_id",
            "entry_id",
            name="uq_lorebook_activation_response_entry",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, nullable=False, index=True)
    entry_id = Column(String, nullable=False, index=True)
    response_message_id = Column(String, nullable=False, index=True)
    entry_revision = Column(Integer, nullable=False)
    trigger_sequence = Column(Integer, nullable=False)
    sticky = Column(Integer, nullable=False, default=0)
    cooldown = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
