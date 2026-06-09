# -*- coding: utf-8 -*-
"""R18内容过滤服务"""
from sqlalchemy.orm import Session
from ..models.system_config import SystemConfig

class NSFWFilter:
    """R18内容过滤器"""

    def __init__(self, db: Session):
        self.db = db
        self._enabled = None

    @property
    def enabled(self) -> bool:
        """获取NSFW开关状态"""
        if self._enabled is None:
            config = self.db.query(SystemConfig).filter(
                SystemConfig.key == "nsfw_enabled"
            ).first()
            self._enabled = config.value.get("enabled", False) if config else False
        return self._enabled

    def set_enabled(self, enabled: bool):
        """设置NSFW开关状态"""
        config = self.db.query(SystemConfig).filter(
            SystemConfig.key == "nsfw_enabled"
        ).first()
        if config:
            config.value = {"enabled": enabled}
        else:
            config = SystemConfig(key="nsfw_enabled", value={"enabled": enabled})
            self.db.add(config)
        self.db.commit()
        self._enabled = enabled

    def filter_characters(self, characters: list) -> list:
        """过滤角色列表"""
        if self.enabled:
            return characters
        return [c for c in characters if not c.get("is_nsfw", False)]

    def filter_images(self, images: list) -> list:
        """过滤图像列表"""
        if self.enabled:
            return images
        return [img for img in images if not img.get("is_nsfw", False)]

    def get_system_prompt_addon(self) -> str:
        """获取系统提示词附加内容"""
        if not self.enabled:
            return "\n\n[系统指令：请确保对话内容健康积极，避免任何色情、暴力、违法内容。保持友好、尊重的交流氛围。]"
        return ""

    def validate_content(self, content: str) -> bool:
        """验证内容是否合规（简单实现）"""
        if self.enabled:
            return True

        # 简单的关键词过滤（实际应用中应该使用更复杂的AI审核）
        forbidden_keywords = [
            "色情", "裸体", "性爱", "成人", "18禁",
            "nsfw", "porn", "nude", "xxx",
        ]
        content_lower = content.lower()
        for keyword in forbidden_keywords:
            if keyword in content_lower:
                return False
        return True
