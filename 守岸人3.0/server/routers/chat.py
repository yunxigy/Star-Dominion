# -*- coding: utf-8 -*-
"""对话路由 - 用户独立会话"""
import json
import uuid
import shutil
import logging
import asyncio
import random
from pathlib import Path
from typing import Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.character import Character
from ..models.chat_db import ChatBranch, ChatSession, ChatMessage
from ..models.user import User
from ..services.chat_history import (
    ChatHistoryService,
    ChatResourceNotFound,
    ChatVersionConflict,
)
from ..services.chat_backups import (
    ChatBackupInvalid,
    ChatBackupService,
    MAX_BACKUP_BYTES,
)
from ..services.lorebook_runtime import LorebookRuntime
from ..utils.prompt_builder import build_system_prompt, build_messages
from ..utils.text_cleaner import clean_text

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

# 这些会在 main.py 中注入
llm_service = None
tts_service = None
stt_service = None
characters_dir: Path = None
chats_dir: Path = None
worlds_dir: Path = None
audio_cache_dir: Path = None
chat_backup_root: Path = None

# TTS 异步任务队列 {task_id: {user_id, status, audio_url, text, error, created_at}}
tts_tasks: Dict[str, dict] = {}


class VersionRequest(BaseModel):
    version: int = Field(ge=1)


class MessageEditRequest(VersionRequest):
    content: str = Field(min_length=1, max_length=20000)


class CheckpointCreateRequest(VersionRequest):
    name: str = Field(min_length=1, max_length=120)
    message_id: Optional[str] = None

# TTS 任务过期时间（秒）
TTS_TASK_EXPIRE = 600  # 10分钟

# 音频文件保留时间（秒）
AUDIO_FILE_EXPIRE = 86400  # 24小时


def _cleanup_tts_tasks():
    """清理过期的 TTS 任务"""
    import time
    now = time.time()
    expired = [tid for tid, task in tts_tasks.items() if now - task.get("created_at", 0) > TTS_TASK_EXPIRE]
    for tid in expired:
        # 删除音频文件
        audio_path = audio_cache_dir / f"tts_{tid}.wav"
        if audio_path.exists():
            audio_path.unlink()
        del tts_tasks[tid]
    if expired:
        logger.info(f"清理了 {len(expired)} 个过期 TTS 任务")


def _cleanup_old_audio_files():
    """清理过期的音频文件"""
    import time
    now = time.time()
    count = 0

    if not audio_cache_dir.exists():
        return

    for audio_file in audio_cache_dir.glob("*.wav"):
        try:
            # 检查文件修改时间
            if now - audio_file.stat().st_mtime > AUDIO_FILE_EXPIRE:
                audio_file.unlink()
                count += 1
        except Exception as e:
            logger.warning(f"清理音频文件失败: {audio_file} - {e}")

    if count > 0:
        logger.info(f"清理了 {count} 个过期音频文件")


def _schedule_cleanup():
    """定期清理任务（在 FastAPI startup 事件中调用）"""
    import asyncio

    async def cleanup_loop():
        while True:
            try:
                _cleanup_tts_tasks()
                _cleanup_old_audio_files()
            except Exception as e:
                logger.error(f"清理任务失败: {e}")
            # 每小时执行一次
            await asyncio.sleep(3600)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(cleanup_loop())
    except RuntimeError:
        # 没有运行中的事件循环，跳过（会在 FastAPI 启动时调用）
        pass


def init_router(llm, tts, stt, chars_dir, c_dir, w_dir, a_dir):
    global llm_service, tts_service, stt_service
    global characters_dir, chats_dir, worlds_dir, audio_cache_dir, chat_backup_root
    llm_service = llm
    tts_service = tts
    stt_service = stt
    characters_dir = chars_dir
    chats_dir = c_dir
    worlds_dir = w_dir
    audio_cache_dir = a_dir
    chat_backup_root = c_dir.parent / "chat_backups"

    # 启动定期清理任务
    _schedule_cleanup()


def _load_character(char_id: str, db: Session) -> Character:
    """加载角色（支持数据库和JSON文件）"""
    from ..models.character_db import CharacterDB

    # 先尝试从数据库加载
    db_char = db.query(CharacterDB).filter(CharacterDB.id == char_id).first()
    if db_char:
        return Character(
            id=db_char.id,
            name=db_char.name,
            description=db_char.description or "",
            personality=db_char.personality or "",
            system_prompt=db_char.system_prompt or "",
            first_mes=db_char.first_mes or "",
            avatar=db_char.avatar_url or "",
            tts=_create_tts_config(db_char),
        )

    # 尝试从 JSON 文件加载
    path = characters_dir / f"{char_id}.json"
    if path.exists():
        return Character.load(path)

    return None


def _create_tts_config(db_char) -> object:
    """从数据库角色创建TTS配置"""
    class TTSConfig:
        def __init__(self, enabled=True, model="mimo-v2.5-tts-voiceclone", voice="冰糖", style_prompt=""):
            self.enabled = enabled
            self.model = model
            self.voice = voice
            self.style_prompt = style_prompt

        def to_dict(self):
            return {
                "enabled": self.enabled,
                "model": self.model,
                "voice": self.voice,
                "style_prompt": self.style_prompt,
            }

    return TTSConfig(
        enabled=getattr(db_char, 'tts_enabled', True),
        model=getattr(db_char, 'tts_model', 'mimo-v2.5-tts-voiceclone'),
        voice=getattr(db_char, 'tts_voice', '冰糖'),
        style_prompt=getattr(db_char, 'tts_style_prompt', ''),
    )


async def _tts_async(task_id: str, text: str, tts_config: dict):
    """异步 TTS 任务"""
    try:
        tts_tasks[task_id]["status"] = "processing"

        loop = asyncio.get_event_loop()
        audio_bytes = await loop.run_in_executor(
            None,
            lambda: tts_service.synthesize(text=text, character_tts=tts_config)
        )

        audio_filename = f"tts_{task_id}.wav"
        audio_path = audio_cache_dir / audio_filename
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)

        tts_tasks[task_id]["status"] = "completed"
        tts_tasks[task_id]["audio_url"] = f"/audio/{audio_filename}"

    except Exception as e:
        logger.error(f"TTS 异步任务失败: {e}")
        tts_tasks[task_id]["status"] = "failed"
        tts_tasks[task_id]["error"] = str(e)


# ========== API 端点 ==========

@router.get("/characters")
async def get_characters_list(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取用户最近使用的角色列表"""
    # 获取用户最近的会话
    recent_sessions = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id
    ).order_by(ChatSession.updated_at.desc()).limit(10).all()

    result = []
    for session in recent_sessions:
        character = _load_character(session.character_id, db)
        if character:
            result.append({
                **character.to_dict(),
                "session_id": session.id,
                "last_active": session.updated_at.isoformat() if session.updated_at else None,
            })

    return result


@router.post("/characters/{char_id}/select")
async def select_character(
    char_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """选择角色，返回角色信息和会话ID"""
    character = _load_character(char_id, db)
    if not character:
        raise HTTPException(status_code=404, detail="角色卡不存在")

    # 获取或创建会话
    session = _get_or_create_session(db, current_user.id, char_id)

    return JSONResponse(content={
        "character": character.to_dict(),
        "session_id": session.id,
    })


@router.post("")
async def chat(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    audio: Optional[UploadFile] = File(None),
    text: Optional[str] = Form(None),
    character_id: Optional[str] = Form(None),
    backend: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    tts_mode: Optional[str] = Form("async"),
):
    """
    对话端点

    参数：
    - character_id: 角色ID（必需，首次对话时传入）
    - session_id: 会话ID（可选，继续对话时传入）
    - text: 文本消息
    - audio: 语音消息
    - backend: LLM后端
    - tts_mode: TTS模式（sync/async）
    """
    # 1. 获取用户输入
    user_input = ""
    if audio:
        temp_path = audio_cache_dir / f"input_{uuid.uuid4()}.wav"
        try:
            with open(temp_path, "wb") as f:
                shutil.copyfileobj(audio.file, f)
            user_input = stt_service.transcribe(str(temp_path))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"语音识别失败: {e}")
        finally:
            if temp_path.exists():
                temp_path.unlink()
    elif text:
        user_input = text
    else:
        raise HTTPException(status_code=400, detail="请提供音频或文本")

    if not user_input.strip():
        raise HTTPException(status_code=400, detail="输入为空")

    # 2. 获取会话和角色
    if session_id:
        # 继续已有会话
        session = db.query(ChatSession).filter(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        ).first()
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        character = _load_character(session.character_id, db)
    elif character_id:
        # 开始新会话或继续已有会话
        session = _get_or_create_session(db, current_user.id, character_id)
        character = _load_character(character_id, db)
    else:
        raise HTTPException(status_code=400, detail="请提供 character_id 或 session_id")

    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")

    # 3. 构建提示词
    history_service = ChatHistoryService(db, owner_id=current_user.id)
    history = [
        {
            "role": message.role,
            "content": history_service.selected_text(message),
        }
        for message in history_service.active_path(session.id)
    ]

    lorebook_runtime = LorebookRuntime(
        db,
        owner_id=current_user.id,
        random_value=random.random,
    )
    lorebook_evaluation = lorebook_runtime.evaluate(
        session.id,
        current_input=user_input,
    )
    world_info_entries = lorebook_evaluation.prompt_entries()

    # 获取用户记忆
    from ..models.memory import Memory, MemorySummary
    memories = db.query(Memory).filter(
        Memory.user_id == current_user.id,
        Memory.character_id == character.id,
        Memory.is_active == True,
    ).order_by(Memory.importance.desc()).limit(10).all()
    memory_list = [{"content": m.content} for m in memories]

    # 获取最近摘要
    summary_obj = db.query(MemorySummary).filter(
        MemorySummary.user_id == current_user.id,
        MemorySummary.character_id == character.id,
    ).order_by(MemorySummary.created_at.desc()).first()
    summary = summary_obj.summary if summary_obj else None

    system_prompt = build_system_prompt(
        character,
        world_info_entries=world_info_entries,
        memories=memory_list,
        summary=summary,
    )
    depth_segments = [
        {
            "depth": item["depth"],
            "order": item["order"],
            "content": item["content"],
            "role": "system",
        }
        for item in world_info_entries
        if item["position"] == "depth"
    ]
    messages = build_messages(system_prompt, history, depth_segments=depth_segments)
    messages.append({"role": "user", "content": user_input})

    # 4. 调用 LLM
    try:
        ai_response = llm_service.chat(messages, backend=backend)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM 调用失败: {e}")

    # 5. 清洗回复文本
    clean_response = clean_text(ai_response, mode="display")

    # 6. 保存对话历史到数据库
    history_service.append_message(session.id, "user", user_input)
    ai_msg = history_service.append_message(
        session.id,
        "assistant",
        clean_response,
    )
    lorebook_runtime.record_evaluation(session.id, ai_msg, lorebook_evaluation)

    # 6.5 异步记忆提取
    msg_count = _count_db_messages(db, session.id)
    if msg_count > 0 and msg_count % 10 == 0:
        try:
            from .memory import extract_memories, create_summary
            from ..database import SessionLocal
            recent_history = _load_db_history(db, session.id, limit=20)
            user_id_str = str(current_user.id)
            char_id_str = str(character.id)
            session_id_str = str(session.id)

            async def _extract_task():
                with SessionLocal() as task_db:
                    await extract_memories(user_id_str, char_id_str, recent_history, task_db)

            async def _summary_task():
                with SessionLocal() as task_db:
                    await create_summary(user_id_str, char_id_str, session_id_str, recent_history, task_db)

            asyncio.create_task(_extract_task())
            if msg_count % 20 == 0:
                asyncio.create_task(_summary_task())
        except Exception as e:
            logger.warning(f"记忆提取失败: {e}")

    # 7. TTS 处理
    audio_url = None
    tts_task_id = None

    if tts_service and tts_service.enabled and character.tts and character.tts.enabled:
        tts_config = character.tts.to_dict() if hasattr(character.tts, 'to_dict') else {}
        tts_text = clean_text(ai_response, mode="tts")

        if tts_mode == "sync":
            try:
                audio_bytes = tts_service.synthesize(text=tts_text, character_tts=tts_config)
                audio_filename = f"resp_{uuid.uuid4()}.wav"
                audio_path = audio_cache_dir / audio_filename
                with open(audio_path, "wb") as f:
                    f.write(audio_bytes)
                audio_url = f"/audio/{audio_filename}"
            except Exception as e:
                logger.warning(f"TTS 合成失败: {e}")
        else:
            # 清理过期任务
            _cleanup_tts_tasks()

            tts_task_id = str(uuid.uuid4())
            tts_tasks[tts_task_id] = {
                "user_id": current_user.id,
                "status": "pending",
                "audio_url": None,
                "text": tts_text,
                "error": None,
                "created_at": __import__('time').time(),
            }
            asyncio.create_task(_tts_async(tts_task_id, tts_text, tts_config))

    return JSONResponse(content={
        "text": clean_response,
        "message_id": ai_msg.id,
        "audio_url": audio_url,
        "tts_task_id": tts_task_id,
        "tts_status": "pending" if tts_task_id else None,
        "character": character.name,
        "character_id": character.id,
        "session_id": session.id,
        "history_length": _count_db_messages(db, session.id),
    })


@router.get("/tts-status/{task_id}")
async def get_tts_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    """查询 TTS 异步任务状态（只能查询自己的任务）"""
    if task_id not in tts_tasks:
        raise HTTPException(status_code=404, detail="任务不存在")

    task = tts_tasks[task_id]

    # 验证任务归属
    if task.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此任务")

    return {
        "task_id": task_id,
        "status": task["status"],
        "audio_url": task.get("audio_url"),
        "error": task.get("error"),
    }


@router.get("/history")
async def get_history(
    session_id: Optional[str] = None,
    character_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取对话历史"""
    service = ChatHistoryService(db, owner_id=current_user.id)
    if session_id:
        try:
            messages = service.active_path(session_id)
        except ChatResourceNotFound:
            raise HTTPException(status_code=404, detail="会话不存在")
        return JSONResponse(
            content=[serialize_chat_message(message) for message in messages]
        )

    if character_id:
        session = db.query(ChatSession).filter(
            ChatSession.user_id == current_user.id,
            ChatSession.character_id == character_id,
        ).first()
        if session:
            messages = service.active_path(session.id)
            return JSONResponse(
                content=[serialize_chat_message(message) for message in messages]
            )

    return JSONResponse(content=[])


@router.delete("/history")
async def clear_history(
    payload: VersionRequest,
    session_id: Optional[str] = None,
    character_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """通过创建空分支清空当前视图，保留原始历史。"""
    service = ChatHistoryService(db, owner_id=current_user.id)
    if not session_id and character_id:
        session = db.query(ChatSession).filter(
            ChatSession.user_id == current_user.id,
            ChatSession.character_id == character_id,
        ).first()
        session_id = session.id if session else None
    if not session_id:
        raise HTTPException(status_code=404, detail="会话不存在")
    try:
        path = service.active_path(session_id)
        service.require_version(session_id, payload.version)
        if path:
            branch = service.delete_from(
                path[0].id,
                expected_version=payload.version,
            )
            session = service.owned_session(branch.session_id)
        else:
            session = service.owned_session(session_id)
    except (ChatResourceNotFound, ChatVersionConflict) as exc:
        _raise_chat_domain_error(exc)

    _snapshot_session(db, owner_id=current_user.id, session=session)
    return {"status": "ok", "version": session.version}


@router.get("/search")
async def search_chats(
    q: str,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="请输入搜索内容")
    safe_limit = min(max(limit, 1), 50)
    rows = (
        db.query(ChatMessage, ChatSession)
        .join(ChatSession, ChatSession.id == ChatMessage.session_id)
        .filter(ChatSession.user_id == current_user.id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .all()
    )
    needle = query.casefold()
    items = []
    for message, session in rows:
        values = [ChatHistoryService.selected_text(message)] + list(
            message.swipes or []
        )
        matched = next(
            (str(value) for value in values if needle in str(value).casefold()),
            None,
        )
        if matched is None:
            continue
        items.append(
            {
                "session_id": session.id,
                "message_id": message.id,
                "branch_id": message.branch_id,
                "role": message.role,
                "snippet": matched[:160],
                "created_at": (
                    message.created_at.isoformat() if message.created_at else None
                ),
            }
        )
        if len(items) >= safe_limit:
            break
    return {"items": items, "query": query}


# ========== JSONL 导出/导入 ==========

@router.get("/export")
async def export_chat_jsonl(
    session_id: Optional[str] = None,
    character_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """导出对话历史为 JSONL 格式"""
    import tempfile

    if session_id:
        session = db.query(ChatSession).filter(
            ChatSession.id == session_id,
            ChatSession.user_id == current_user.id,
        ).first()
    elif character_id:
        session = db.query(ChatSession).filter(
            ChatSession.user_id == current_user.id,
            ChatSession.character_id == character_id,
        ).first()
    else:
        raise HTTPException(status_code=400, detail="请提供 session_id 或 character_id")

    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    history_service = ChatHistoryService(db, owner_id=current_user.id)
    messages = history_service.active_path(session.id)

    # 写入 JSONL
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False, mode="w", encoding="utf-8") as tmp:
        for msg in messages:
            line = {
                "role": msg.role,
                "content": msg.content if isinstance(msg.content, dict) else {"text": str(msg.content)},
                "swipes": msg.swipes or [],
                "swipe_id": int(msg.swipe_id) if msg.swipe_id else 0,
                "timestamp": msg.created_at.isoformat() if msg.created_at else None,
            }
            tmp.write(json.dumps(line, ensure_ascii=False) + "\n")
        tmp_path = tmp.name

    character = _load_character(session.character_id, db)
    filename = f"{character.name if character else 'chat'}_{session.id[:8]}.jsonl"

    from fastapi.responses import FileResponse
    return FileResponse(tmp_path, media_type="application/jsonl", filename=filename)


@router.post("/import")
async def import_chat_jsonl(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
    character_id: str = Form(...),
):
    """导入 JSONL 对话历史"""
    # 读取 JSONL
    content = await file.read()
    lines = content.decode("utf-8").strip().split("\n")

    messages = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            messages.append(msg)
        except json.JSONDecodeError:
            continue

    if not messages:
        raise HTTPException(status_code=400, detail="文件中没有有效消息")

    # 获取或创建会话
    session = _get_or_create_session(db, current_user.id, character_id)

    # 导入消息到当前活动分支
    history_service = ChatHistoryService(db, owner_id=current_user.id)
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", {})
        if isinstance(content, str):
            content = {"text": content}
        imported = history_service.append_message(
            session.id,
            role,
            str(content.get("text", "")),
        )
        if role == "assistant" and msg.get("swipes"):
            imported.swipes = list(msg["swipes"])
            imported.swipe_id = str(msg.get("swipe_id", 0))
            db.commit()

    return {
        "status": "ok",
        "imported": len(messages),
        "session_id": session.id,
    }


@router.get("/sessions/{session_id}/backup")
async def export_full_chat_backup(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        payload = ChatBackupService(
            db,
            root=chat_backup_root or Path("."),
        ).export_session(session_id, owner_id=current_user.id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="会话不存在") from exc
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": (
                f'attachment; filename="shouanren-{session_id[:8]}-backup.json"'
            )
        },
    )


@router.post("/backup/import")
async def import_full_chat_backup(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    raw = await file.read(MAX_BACKUP_BYTES + 1)
    if len(raw) > MAX_BACKUP_BYTES:
        raise HTTPException(status_code=400, detail="备份文件超过 10 MiB")
    try:
        payload = json.loads(raw.decode("utf-8"))
        backups = ChatBackupService(
            db,
            root=chat_backup_root or Path("."),
        )
        imported = backups.import_session(payload, owner_id=current_user.id)
        imported_session = db.get(ChatSession, imported.session_id)
        _snapshot_session(
            db,
            owner_id=current_user.id,
            session=imported_session,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ChatBackupInvalid) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "status": "ok",
        "session_id": imported.session_id,
        "branch_count": imported.branch_count,
        "message_count": imported.message_count,
        "checkpoint_count": imported.checkpoint_count,
    }


@router.get("/sessions")
async def get_user_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取用户的所有会话"""
    sessions = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id
    ).order_by(ChatSession.updated_at.desc()).all()

    result = []
    for s in sessions:
        character = _load_character(s.character_id, db)
        msg_count = _count_db_messages(db, s.id)
        result.append({
            "session_id": s.id,
            "character_id": s.character_id,
            "character_name": character.name if character else "未知角色",
            "message_count": msg_count,
            "last_active": s.updated_at.isoformat() if s.updated_at else None,
        })

    return result


@router.patch("/messages/{message_id}")
async def edit_chat_message(
    message_id: str,
    payload: MessageEditRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        message = service.edit_message(
            message_id,
            payload.content,
            expected_version=payload.version,
        )
        session = service.owned_session(message.session_id)
    except (ChatResourceNotFound, ChatVersionConflict, ValueError) as exc:
        _raise_chat_domain_error(exc)
    _snapshot_session(db, owner_id=current_user.id, session=session)
    return {"message": serialize_chat_message(message), "version": session.version}


@router.delete("/messages/{message_id}")
async def delete_chat_message(
    message_id: str,
    payload: VersionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        branch = service.delete_from(
            message_id,
            expected_version=payload.version,
        )
        session = service.owned_session(branch.session_id)
    except (ChatResourceNotFound, ChatVersionConflict) as exc:
        _raise_chat_domain_error(exc)
    _snapshot_session(db, owner_id=current_user.id, session=session)
    return {
        "branch": serialize_chat_branch(
            branch,
            active_branch_id=session.current_branch_id,
        ),
        "version": session.version,
    }


@router.get("/sessions/{session_id}/branches")
async def list_chat_branches(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        session = service.owned_session(session_id)
        branches = service.list_branches(session_id)
    except ChatResourceNotFound as exc:
        _raise_chat_domain_error(exc)
    return {
        "items": [
            serialize_chat_branch(
                branch,
                active_branch_id=session.current_branch_id,
            )
            for branch in branches
        ],
        "version": session.version,
    }


@router.post("/sessions/{session_id}/branches/{branch_id}/activate")
async def activate_chat_branch(
    session_id: str,
    branch_id: str,
    payload: VersionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        session = service.activate_branch(
            session_id,
            branch_id,
            expected_version=payload.version,
        )
    except (ChatResourceNotFound, ChatVersionConflict) as exc:
        _raise_chat_domain_error(exc)
    _snapshot_session(db, owner_id=current_user.id, session=session)
    return {"version": session.version, "branch_id": session.current_branch_id}


@router.get("/sessions/{session_id}/checkpoints")
async def list_chat_checkpoints(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        session = service.owned_session(session_id)
        checkpoints = service.list_checkpoints(session_id)
    except ChatResourceNotFound as exc:
        _raise_chat_domain_error(exc)
    return {
        "items": [serialize_chat_checkpoint(item) for item in checkpoints],
        "version": session.version,
    }


@router.post("/sessions/{session_id}/checkpoints")
async def create_chat_checkpoint(
    session_id: str,
    payload: CheckpointCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        checkpoint = service.create_checkpoint(
            session_id,
            payload.name,
            payload.message_id,
            expected_version=payload.version,
        )
        session = service.owned_session(session_id)
    except (ChatResourceNotFound, ChatVersionConflict, ValueError) as exc:
        _raise_chat_domain_error(exc)
    _snapshot_session(db, owner_id=current_user.id, session=session)
    return {
        "checkpoint": serialize_chat_checkpoint(checkpoint),
        "version": session.version,
    }


@router.post("/checkpoints/{checkpoint_id}/restore")
async def restore_chat_checkpoint(
    checkpoint_id: str,
    payload: VersionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        session = service.restore_checkpoint(
            checkpoint_id,
            expected_version=payload.version,
        )
    except (ChatResourceNotFound, ChatVersionConflict) as exc:
        _raise_chat_domain_error(exc)
    _snapshot_session(db, owner_id=current_user.id, session=session)
    return {"version": session.version, "branch_id": session.current_branch_id}


@router.delete("/checkpoints/{checkpoint_id}")
async def delete_chat_checkpoint(
    checkpoint_id: str,
    payload: VersionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        session = service.delete_checkpoint(
            checkpoint_id,
            expected_version=payload.version,
        )
    except (ChatResourceNotFound, ChatVersionConflict) as exc:
        _raise_chat_domain_error(exc)
    _snapshot_session(db, owner_id=current_user.id, session=session)
    return {"status": "ok", "version": session.version}


# ========== 内部工具函数 ==========

def _get_or_create_session(db: Session, user_id: str, character_id: str) -> ChatSession:
    """获取或创建会话"""
    session = db.query(ChatSession).filter(
        ChatSession.user_id == user_id,
        ChatSession.character_id == character_id,
    ).first()

    if not session:
        session = ChatSession(
            user_id=user_id,
            character_id=character_id,
            version=1,
        )
        db.add(session)
        db.flush()
        branch = ChatBranch(session_id=session.id, name="主分支")
        db.add(branch)
        db.flush()
        session.current_branch_id = branch.id
        db.commit()
        db.refresh(session)

    return session


def _load_db_history(db: Session, session_id: str, limit: int = 20) -> list:
    """从数据库加载对话历史"""
    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.created_at.desc()).limit(limit).all()

    history = []
    for msg in reversed(messages):
        content = msg.content if isinstance(msg.content, dict) else json.loads(msg.content)
        history.append({
            "role": "user" if msg.role == "user" else "assistant",
            "content": content.get("text", ""),
        })
    return history


def _count_db_messages(db: Session, session_id: str) -> int:
    """统计会话消息数"""
    return db.query(ChatMessage).filter(ChatMessage.session_id == session_id).count()


def serialize_chat_message(message: ChatMessage) -> dict:
    try:
        swipe_id = int(message.swipe_id or 0)
    except (TypeError, ValueError):
        swipe_id = 0
    swipes = list(message.swipes or [])
    content = ChatHistoryService.selected_text(message)
    return {
        "id": message.id,
        "role": message.role,
        "content": content,
        "swipes": swipes,
        "swipe_id": swipe_id,
        "branch_id": message.branch_id,
        "parent_message_id": message.parent_message_id,
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "edited_at": message.edited_at.isoformat() if message.edited_at else None,
    }


def serialize_chat_branch(branch: ChatBranch, *, active_branch_id: str) -> dict:
    return {
        "id": branch.id,
        "session_id": branch.session_id,
        "parent_branch_id": branch.parent_branch_id,
        "fork_message_id": branch.fork_message_id,
        "head_message_id": branch.head_message_id,
        "name": branch.name,
        "is_active": branch.id == active_branch_id,
        "created_at": branch.created_at.isoformat() if branch.created_at else None,
    }


def serialize_chat_checkpoint(checkpoint) -> dict:
    return {
        "id": checkpoint.id,
        "session_id": checkpoint.session_id,
        "branch_id": checkpoint.branch_id,
        "message_id": checkpoint.message_id,
        "name": checkpoint.name,
        "created_at": (
            checkpoint.created_at.isoformat() if checkpoint.created_at else None
        ),
    }


def _raise_chat_domain_error(exc: Exception) -> None:
    if isinstance(exc, ChatResourceNotFound):
        raise HTTPException(status_code=404, detail="对话资源不存在") from exc
    if isinstance(exc, ChatVersionConflict):
        raise HTTPException(status_code=409, detail="对话已在其他页面更新") from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise exc


def _snapshot_session(
    db: Session,
    *,
    owner_id: str,
    session: ChatSession,
) -> None:
    if chat_backup_root is None:
        return
    try:
        ChatBackupService(db, root=chat_backup_root).snapshot_after_change(
            session.id,
            owner_id=owner_id,
            version=session.version,
        )
    except Exception as exc:
        logger.exception("聊天自动备份失败: %s", session.id)
        raise HTTPException(status_code=500, detail="聊天已保存，但自动备份失败") from exc


# ========== Swipe 相关端点 ==========

def _regenerate_message(
    *,
    message_id: str,
    version: int,
    backend: Optional[str],
    current_user: User,
    db: Session,
) -> ChatMessage:
    service = ChatHistoryService(db, owner_id=current_user.id)
    try:
        target = service.owned_message(message_id)
        session = service.require_version(target.session_id, version)
    except ChatResourceNotFound as exc:
        raise HTTPException(status_code=404, detail="消息不存在") from exc
    except ChatVersionConflict as exc:
        raise HTTPException(status_code=409, detail="对话已在其他页面更新") from exc

    character = _load_character(session.character_id, db)
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")
    context = service.context_before(message_id)
    history = [
        {"role": message.role, "content": service.selected_text(message)}
        for message in context
    ]
    current_input = next(
        (item["content"] for item in reversed(history) if item["role"] == "user"),
        "",
    )
    runtime = LorebookRuntime(
        db,
        owner_id=current_user.id,
        random_value=random.random,
    )
    evaluation = runtime.evaluate(
        session.id,
        current_input=current_input,
        advance_sequence=False,
        messages=context,
    )
    prompt_entries = evaluation.prompt_entries()
    depth_segments = [
        {
            "depth": item["depth"],
            "order": item["order"],
            "content": item["content"],
            "role": "system",
        }
        for item in prompt_entries
        if item["position"] == "depth"
    ]
    messages = build_messages(
        build_system_prompt(character, world_info_entries=prompt_entries),
        history,
        depth_segments=depth_segments,
    )
    try:
        ai_response = llm_service.chat(messages, backend=backend)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"LLM 调用失败: {exc}") from exc
    clean_response = clean_text(ai_response, mode="display")

    try:
        service.require_version(target.session_id, version)
    except ChatVersionConflict as exc:
        raise HTTPException(status_code=409, detail="对话已在其他页面更新") from exc
    return service.append_swipe(message_id, clean_response)


@router.post("/messages/{message_id}/regenerate")
async def regenerate_message(
    message_id: str,
    version: int = Form(...),
    backend: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updated = _regenerate_message(
        message_id=message_id,
        version=version,
        backend=backend,
        current_user=current_user,
        db=db,
    )
    return serialize_chat_message(updated)

@router.post("/swipe")
async def swipe_regenerate(
    message_id: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    backend: Optional[str] = Form(None),
):
    """重新生成回复（添加新的 swipe）"""
    try:
        service = ChatHistoryService(db, owner_id=current_user.id)
        target = service.owned_message(message_id)
        session = service.owned_session(target.session_id)
    except ChatResourceNotFound as exc:
        raise HTTPException(status_code=404, detail="消息不存在") from exc
    updated = _regenerate_message(
        message_id=message_id,
        version=session.version,
        backend=backend,
        current_user=current_user,
        db=db,
    )
    payload = serialize_chat_message(updated)
    payload.update({"message_id": updated.id, "text": payload["content"]})
    return JSONResponse(
        content=payload,
        headers={"Deprecation": "true", "Sunset": "version-next"},
    )


@router.put("/swipe")
async def swipe_switch(
    message_id: str = Form(...),
    swipe_id: int = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """切换到指定的 swipe"""
    msg = db.query(ChatMessage).filter(ChatMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")

    session = db.query(ChatSession).filter(
        ChatSession.id == msg.session_id,
        ChatSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=403, detail="无权操作")

    swipes = msg.swipes or [msg.content.get("text", "")]
    if swipe_id < 0 or swipe_id >= len(swipes):
        raise HTTPException(status_code=400, detail="无效的 swipe 索引")

    msg.swipe_id = str(swipe_id)
    msg.content = {"text": swipes[swipe_id]}
    db.commit()

    return {
        "message_id": message_id,
        "text": swipes[swipe_id],
        "swipes": swipes,
        "swipe_id": swipe_id,
    }
