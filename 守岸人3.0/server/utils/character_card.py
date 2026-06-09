# -*- coding: utf-8 -*-
"""Tavern Card 角色卡格式支持（PNG tEXt chunk）"""
import base64
import json
import io
from pathlib import Path
from typing import Optional

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False


# Tavern Card V2 规范字段
CARD_V2_SPEC = "chara_card_v2"
CARD_V2_VERSION = "2.0"

# PNG tEXt chunk 关键字
CHARA_KEYWORD_V2 = "chara"
CHARA_KEYWORD_V3 = "ccv3"


def read_card_from_png(png_path: str) -> Optional[dict]:
    """
    从 PNG 文件读取角色卡数据

    Args:
        png_path: PNG 文件路径

    Returns:
        角色卡字典，失败返回 None
    """
    if not HAS_PILLOW:
        raise RuntimeError("需要安装 Pillow: pip install Pillow")

    img = Image.open(png_path)

    # 读取 tEXt chunks
    text_chunks = {}
    if hasattr(img, "info"):
        for key, value in img.info.items():
            if key in (CHARA_KEYWORD_V2, CHARA_KEYWORD_V3):
                text_chunks[key] = value

    # 优先 V3，回退 V2
    raw = text_chunks.get(CHARA_KEYWORD_V3) or text_chunks.get(CHARA_KEYWORD_V2)
    if not raw:
        return None

    try:
        decoded = base64.b64decode(raw).decode("utf-8")
        card_data = json.loads(decoded)
    except Exception:
        return None

    return card_data


def write_card_to_png(card_data: dict, source_png: str, output_png: str):
    """
    将角色卡数据写入 PNG 文件的 tEXt chunk

    Args:
        card_data: 角色卡字典（V2 格式）
        source_png: 源 PNG 文件路径
        output_png: 输出 PNG 文件路径
    """
    if not HAS_PILLOW:
        raise RuntimeError("需要安装 Pillow: pip install Pillow")

    img = Image.open(source_png)

    # 构建 V2 格式
    v2_card = {
        "spec": CARD_V2_SPEC,
        "spec_version": CARD_V2_VERSION,
        "data": card_data,
    }

    # Base64 编码
    json_str = json.dumps(v2_card, ensure_ascii=False)
    encoded = base64.b64encode(json_str.encode("utf-8")).decode("utf-8")

    # 写入 tEXt chunk
    img.info[CHARA_KEYWORD_V2] = encoded

    # 保存
    img.save(output_png, "PNG")


def card_to_tavern_v2(character) -> dict:
    """
    将内部角色对象转换为 Tavern Card V2 格式

    Args:
        character: Character 对象

    Returns:
        Tavern Card V2 data 字段
    """
    return {
        "name": character.name or "",
        "description": character.description or "",
        "personality": character.personality or "",
        "scenario": "",
        "first_mes": character.first_mes or "",
        "mes_example": character.mes_example or "",
        "creator_notes": "",
        "system_prompt": character.system_prompt or "",
        "post_history_instructions": "",
        "alternate_greetings": [],
        "tags": character.tags or [],
        "creator": "守岸人 3.0",
        "character_version": "1.0",
        "character_book": None,
        "extensions": {
            "talkativeness": 0.5,
            "fav": False,
            "world": "",
            "depth_prompt": {
                "prompt": "",
                "depth": 4,
                "role": "system",
            },
        },
    }


def tavern_v2_to_card(card_data: dict) -> dict:
    """
    将 Tavern Card V2 格式转换为内部角色格式

    Args:
        card_data: Tavern Card V2 data 字段

    Returns:
        内部角色字典
    """
    return {
        "name": card_data.get("name", ""),
        "description": card_data.get("description", ""),
        "personality": card_data.get("personality", ""),
        "system_prompt": card_data.get("system_prompt", ""),
        "first_mes": card_data.get("first_mes", ""),
        "mes_example": card_data.get("mes_example", ""),
        "tags": card_data.get("tags", []),
    }


def import_from_json(json_path: str) -> Optional[dict]:
    """从 JSON 文件导入角色卡"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 检测格式
    if "spec" in data and data.get("spec") == CARD_V2_SPEC:
        # Tavern Card V2 格式
        return tavern_v2_to_card(data.get("data", data))
    elif "name" in data:
        # 简单 JSON 格式
        return tavern_v2_to_card(data)

    return None


def export_to_json(character, output_path: str):
    """将角色卡导出为 Tavern Card V2 JSON"""
    v2_card = {
        "spec": CARD_V2_SPEC,
        "spec_version": CARD_V2_VERSION,
        "data": card_to_tavern_v2(character),
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(v2_card, f, ensure_ascii=False, indent=2)
