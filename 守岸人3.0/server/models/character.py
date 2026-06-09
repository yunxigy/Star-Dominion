# -*- coding: utf-8 -*-
"""角色卡数据模型"""
import json
import uuid
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional


@dataclass
class CharacterTTSConfig:
    """角色的 TTS 配置"""
    enabled: bool = True
    model: str = "mimo-v2.5-tts-voiceclone"  # mimo-v2.5-tts / mimo-v2.5-tts-voiceclone / mimo-v2.5-tts-voicedesign
    voice: str = "冰糖"  # 预置音色名 或 "clone" 表示使用参考音频
    ref_audio_path: str = ""  # 参考音频文件路径（voiceclone 模式）
    ref_audio_filename: str = ""  # 参考音频文件名（用于显示）
    style_prompt: str = ""  # 风格指令（自然语言描述）

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Character:
    """角色卡"""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = ""
    description: str = ""  # 角色描述
    personality: str = ""  # 性格特点
    system_prompt: str = ""  # 系统提示词
    first_mes: str = ""  # 首次对话消息
    mes_example: str = ""  # 示例对话
    avatar: str = ""  # 头像文件名
    tags: list = field(default_factory=list)
    tts: CharacterTTSConfig = field(default_factory=CharacterTTSConfig)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, data: dict) -> "Character":
        tts_data = data.pop("tts", {})
        tts = CharacterTTSConfig(**tts_data) if tts_data else CharacterTTSConfig()
        # 过滤掉未知字段
        valid_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {k: v for k, v in data.items() if k in valid_fields}
        return cls(tts=tts, **filtered)

    def save(self, characters_dir: Path):
        """保存角色卡到文件"""
        characters_dir.mkdir(parents=True, exist_ok=True)
        self.updated_at = time.time()
        path = characters_dir / f"{self.id}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: Path) -> "Character":
        """从文件加载角色卡"""
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)

    @classmethod
    def load_all(cls, characters_dir: Path) -> list:
        """加载所有角色卡"""
        characters_dir.mkdir(parents=True, exist_ok=True)
        characters = []
        for path in sorted(characters_dir.glob("*.json")):
            try:
                characters.append(cls.load(path))
            except Exception as e:
                print(f"⚠️ 加载角色卡失败 {path}: {e}")
        return characters

    def delete(self, characters_dir: Path):
        """删除角色卡文件"""
        path = characters_dir / f"{self.id}.json"
        if path.exists():
            path.unlink()
