# -*- coding: utf-8 -*-
"""设置路由"""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..config import CONFIG, save_config
from ..database import get_db
from ..middleware.auth import get_current_admin, get_current_user
from ..models.user import User

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings(current_user: User = Depends(get_current_user)):
    """获取当前设置（脱敏）"""
    safe = _mask_secrets(CONFIG)
    return JSONResponse(content=safe)


@router.put("")
async def update_settings(
    body: dict,
    current_admin: User = Depends(get_current_admin),
):
    """更新设置"""
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
