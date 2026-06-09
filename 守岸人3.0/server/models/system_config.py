# -*- coding: utf-8 -*-
"""系统配置模型"""
from sqlalchemy import Column, String, JSON, DateTime
from sqlalchemy.sql import func
from ..database import Base

class SystemConfig(Base):
    __tablename__ = "system_config"

    key = Column(String(100), primary_key=True)
    value = Column(JSON, nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def to_dict(self):
        return {
            "key": self.key,
            "value": self.value,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
