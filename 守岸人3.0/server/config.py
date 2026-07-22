# -*- coding: utf-8 -*-
"""配置管理"""
import os
import yaml
from pathlib import Path

BASE_DIR = Path(__file__).parent
ROOT_DIR = BASE_DIR.parent
DATA_DIR = ROOT_DIR / "data"
FRONTEND_DIR = ROOT_DIR / "frontend"

CONFIG_FILE = DATA_DIR / "config.yaml"

DEFAULT_CONFIG = {
    "server": {
        "host": "0.0.0.0",
        "port": 8006,
    },
    "llm": {
        "default_backend": "openai",
        "backends": {
            "openai": {
                "api_key": "",
                "base_url": "https://api.openai.com/v1",
                "model": "gpt-4o",
            },
            "deepseek": {
                "api_key": "",
                "base_url": "https://api.deepseek.com/v1",
                "model": "deepseek-chat",
            },
            "anthropic": {
                "api_key": "",
                "model": "claude-sonnet-4-20250514",
            },
            "gemini": {
                "api_key": "",
                "model": "gemini-2.0-flash",
            },
            "moonshot": {
                "api_key": "",
                "base_url": "https://api.moonshot.cn/v1",
                "model": "moonshot-v1-8k",
            },
            "volcengine": {
                "api_key": "",
                "base_url": "https://ark.cn-beijing.volces.com/api/v3",
                "model": "doubao-pro-32k",
            },
        },
    },
    "tts": {
        "enabled": True,
        "api_key": "",
        "base_url": "https://api.xiaomimimo.com/v1",
        "default_model": "mimo-v2.5-tts-voiceclone",
        "default_voice": "冰糖",
        "format": "wav",
    },
    "stt": {
        "enabled": True,
        "engine": "whisper",
        "model": "base",
        "device": "cpu",
    },
}


def load_config() -> dict:
    """加载配置，不存在则创建默认配置"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            user_cfg = yaml.safe_load(f) or {}
        # 合并默认配置
        return _deep_merge(DEFAULT_CONFIG, user_cfg)
    else:
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()


def save_config(cfg: dict):
    """保存配置到文件"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False)


def _deep_merge(base: dict, override: dict) -> dict:
    """深度合并字典"""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


# 全局配置实例
CONFIG = load_config()
