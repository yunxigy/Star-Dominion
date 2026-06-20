# -*- coding: utf-8 -*-
"""设置路由 — 拆分用户设置和系统设置"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..config import CONFIG, save_config
from ..database import get_db
from ..middleware.auth import get_current_admin, get_current_user
from ..models.user import User

router = APIRouter(prefix="/api/settings", tags=["settings"])

# 用户可修改的设置项（白名单）
_USER_WRITABLE_KEYS = {
    "llm.default_backend",    # 选择哪个 LLM 后端
    "ui.theme",               # 主题
    "ui.language",            # 语言
    "chat.temperature",       # 温度
    "chat.max_tokens",        # 最大 token
    "tts.default_model",      # TTS 模型
}

# 系统设置（仅管理员）
_SYSTEM_KEYS = {
    "llm.backends",           # API Key 等
    "server",                 # 端口、host
    "cors",                   # CORS 配置
    "database",               # 数据库配置
}


@router.get("")
async def get_settings(current_user: User = Depends(get_current_user)):
    """获取当前设置（脱敏）"""
    safe = _mask_secrets(CONFIG)
    return JSONResponse(content=safe)


@router.put("")
async def update_user_settings(
    body: dict,
    current_user: User = Depends(get_current_user),
):
    """普通用户更新自己的设置（白名单范围内）"""
    # 只允许修改白名单内的设置
    filtered = _filter_user_writable(body)
    if not filtered:
        raise HTTPException(status_code=400, detail="没有可修改的设置项")
    _deep_update(CONFIG, filtered)
    save_config(CONFIG)
    return {"status": "ok", "updated": list(filtered.keys())}


@router.put("/system")
async def update_system_settings(
    body: dict,
    current_admin: User = Depends(get_current_admin),
):
    """管理员更新系统设置"""
    _deep_update(CONFIG, body)
    save_config(CONFIG)
    return {"status": "ok"}


@router.get("/backends")
async def list_backends(current_user: User = Depends(get_current_user)):
    """获取可用的 LLM 后端列表"""
    backends = CONFIG.get("llm", {}).get("backends", {})
    result = []
    for name, cfg in backends.items():
        result.append({
            "name": name,
            "model": cfg.get("model", ""),
            "base_url": cfg.get("base_url", ""),
            "has_key": bool(cfg.get("api_key")),
        })
    return JSONResponse(content=result)


def _filter_user_writable(body: dict, prefix: str = "") -> dict:
    """过滤出用户可写的设置项"""
    result = {}
    for key, value in body.items():
        full_path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            nested = _filter_user_writable(value, full_path)
            if nested:
                result[key] = nested
        elif full_path in _USER_WRITABLE_KEYS:
            result[key] = value
    return result


def _mask_secrets(obj, path=""):
    """脱敏处理"""
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            full_path = f"{path}.{k}" if path else k
            if "key" in k.lower() or "secret" in k.lower():
                result[k] = "***" if v else ""
            else:
                result[k] = _mask_secrets(v, full_path)
        return result
    elif isinstance(obj, list):
        return [_mask_secrets(item, path) for item in obj]
    return obj


def _deep_update(base: dict, override: dict):
    """深度更新字典"""
    for key, value in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_update(base[key], value)
        else:
            base[key] = value
