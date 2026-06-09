# -*- coding: utf-8 -*-
"""图像生成记录模型"""
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from ..database import Base
import uuid

class GeneratedImage(Base):
    __tablename__ = "generated_images"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    prompt = Column(Text, nullable=False)
    negative_prompt = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    task_id = Column(String(100), nullable=True)  # ComfyUI任务ID
    status = Column(String(20), default="pending")  # pending / processing / completed / failed
    is_nsfw = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "prompt": self.prompt,
            "negative_prompt": self.negative_prompt,
            "image_url": self.image_url,
            "status": self.status,
            "is_nsfw": self.is_nsfw,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
