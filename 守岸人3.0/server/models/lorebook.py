# -*- coding: utf-8 -*-
"""Lorebook（世界书）数据模型 - 增强版"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, JSON, Integer, Float
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
    group = Column(String(50), nullable=True)  # 分组名（同组条目按权重选择）
    group_weight = Column(Integer, default=100)  # 分组内权重

    # 匹配选项
    case_sensitive = Column(Boolean, default=False)  # 大小写敏感
    match_whole_words = Column(Boolean, default=False)  # 全词匹配
    exclude_recursion = Column(Boolean, default=False)  # 排除递归触发

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
            "group": self.group,
            "group_weight": self.group_weight,
            "case_sensitive": self.case_sensitive,
            "match_whole_words": self.match_whole_words,
            "exclude_recursion": self.exclude_recursion,
            "comment": self.comment,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
