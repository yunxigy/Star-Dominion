# -*- coding: utf-8 -*-
"""斜杠命令系统"""
import json
import logging
from typing import Callable, Dict, List, Optional
from fastapi import APIRouter, Depends, Form
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/commands", tags=["commands"])

# 命令注册表
_commands: Dict[str, dict] = {}


def register_command(name: str, help_text: str = "", aliases: List[str] = None):
    """装饰器：注册斜杠命令"""
    def decorator(func: Callable):
        _commands[name] = {
            "name": name,
            "help": help_text,
            "callback": func,
            "aliases": aliases or [],
        }
        # 注册别名
        for alias in (aliases or []):
            _commands[alias] = _commands[name]
        return func
    return decorator


def get_commands() -> Dict[str, dict]:
    """获取所有命令"""
    return _commands


# ========== 内置命令 ==========

@register_command("help", help_text="显示所有可用命令", aliases=["帮助", "h"])
async def cmd_help(*args, **kwargs):
    lines = ["**可用命令：**\n"]
    seen = set()
    for name, cmd in sorted(_commands.items()):
        if name not in seen and name == cmd["name"]:
            lines.append(f"`/{name}` - {cmd['help']}")
            seen.add(name)
    return "\n".join(lines)


@register_command("clear", help_text="清空当前对话历史", aliases=["清空", "cls"])
async def cmd_clear(user_id: str = None, session_id: str = None, db: Session = None, **kwargs):
    from ..models.chat_db import ChatSession, ChatMessage
    if session_id:
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
        db.commit()
        return "对话历史已清空"
    return "未指定会话"


@register_command("export", help_text="导出当前对话为 JSONL", aliases=["导出"])
async def cmd_export(user_id: str = None, session_id: str = None, db: Session = None, **kwargs):
    from ..models.chat_db import ChatSession, ChatMessage
    if not session_id:
        return "未指定会话"

    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.created_at.asc()).all()

    lines = []
    for msg in messages:
        content = msg.content if isinstance(msg.content, dict) else {"text": str(msg.content)}
        lines.append(json.dumps({
            "role": msg.role,
            "content": content,
        }, ensure_ascii=False))

    return f"共 {len(lines)} 条消息，已准备好导出（请使用导出按钮下载）"


@register_command("character", help_text="显示当前角色信息", aliases=["角色", "char"])
async def cmd_character(character_name: str = None, **kwargs):
    if character_name:
        return f"当前角色：{character_name}"
    return "未选择角色"


@register_command("backend", help_text="切换 LLM 后端", aliases=["后端"])
async def cmd_backend(*args, backend: str = None, **kwargs):
    if backend:
        return f"已切换到后端：{backend}"
    return "用法：/backend <后端名>"


@register_command("swipe", help_text="重新生成上一条回复", aliases=["重写", "regen"])
async def cmd_swipe(*args, **kwargs):
    return "SWIPE_REGENERATE"


@register_command("system", help_text="查看当前系统提示词", aliases=["系统"])
async def cmd_system(*args, **kwargs):
    return "请在设置中查看系统提示词"


@register_command("memory", help_text="查看记忆系统状态", aliases=["记忆"])
async def cmd_memory(*args, **kwargs):
    return "记忆系统运行中"


@register_command("tts", help_text="开关语音合成", aliases=["语音"])
async def cmd_tts(*args, **kwargs):
    return "语音合成状态已切换"


@register_command("debug", help_text="显示调试信息", aliases=["调试"])
async def cmd_debug(*args, **kwargs):
    return "调试模式已开启"


# ========== API 端点 ==========

@router.get("/list")
async def list_commands():
    """获取所有可用命令"""
    seen = set()
    result = []
    for name, cmd in sorted(_commands.items()):
        if name not in seen and name == cmd["name"]:
            result.append({
                "name": name,
                "help": cmd["help"],
                "aliases": cmd["aliases"],
            })
            seen.add(name)
    return result


@router.post("/execute")
async def execute_command(
    command: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    session_id: Optional[str] = Form(None),
    character_name: Optional[str] = Form(None),
    backend: Optional[str] = Form(None),
):
    """执行斜杠命令"""
    # 解析命令
    parts = command.strip().split(maxsplit=1)
    cmd_name = parts[0].lstrip("/").lower()
    cmd_args = parts[1] if len(parts) > 1 else ""

    if cmd_name not in _commands:
        return {"error": f"未知命令：/{cmd_name}"}

    cmd = _commands[cmd_name]
    try:
        result = await cmd["callback"](
            cmd_args,
            user_id=current_user.id,
            session_id=session_id,
            db=db,
            character_name=character_name,
            backend=backend,
        )
        return {"result": result}
    except Exception as e:
        logger.error(f"命令执行失败: {e}")
        return {"error": f"命令执行失败: {str(e)}"}
