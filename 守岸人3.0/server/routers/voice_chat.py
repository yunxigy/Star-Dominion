# -*- coding: utf-8 -*-
"""语音陪伴路由"""
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..database import get_db, SessionLocal
from ..models.user import User
from ..models.voice_session import VoiceSession, VoiceMessage
from ..models.character_db import CharacterDB
from ..middleware.auth import get_current_user
from ..services.llm_service import LLMService
from ..services.tts_service import TTSService
from ..services.stt_service import STTService
import json
import asyncio
import base64
import tempfile
import os
from pathlib import Path

router = APIRouter(prefix="/api/voice-chat", tags=["voice-chat"])

# 服务实例（会在init中设置）
llm_service = None
tts_service = None
stt_service = None

# 音频缓存目录
AUDIO_CACHE_DIR = Path(__file__).parent.parent.parent / "data" / "audio_cache"

def init_router(llm: LLMService, tts: TTSService, stt: STTService):
    global llm_service, tts_service, stt_service
    llm_service = llm
    tts_service = tts
    stt_service = stt

class VoiceSessionCreate(BaseModel):
    character_id: str

# ========== REST API ==========

@router.post("/start")
async def start_voice_session(
    req: VoiceSessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """开始语音会话"""
    # 检查角色是否存在
    character = db.query(CharacterDB).filter(CharacterDB.id == req.character_id).first()
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")

    # 创建语音会话
    session = VoiceSession(
        user_id=current_user.id,
        character_id=req.character_id,
        status="active",
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return session.to_dict()

@router.post("/{session_id}/stop")
async def stop_voice_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """结束语音会话"""
    session = db.query(VoiceSession).filter(VoiceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权操作此会话")

    session.status = "ended"
    db.commit()

    return {"message": "会话已结束"}

@router.get("/{session_id}")
async def get_voice_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取语音会话状态"""
    session = db.query(VoiceSession).filter(VoiceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此会话")

    return session.to_dict()

@router.get("/{session_id}/messages")
async def get_voice_messages(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取语音消息历史"""
    session = db.query(VoiceSession).filter(VoiceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此会话")

    messages = db.query(VoiceMessage).filter(
        VoiceMessage.voice_session_id == session_id
    ).order_by(VoiceMessage.created_at).all()

    return [m.to_dict() for m in messages]

# ========== WebSocket ==========

# 短期ticket存储 {ticket: {user_id, session_id, expires_at}}
ws_tickets = {}

def generate_ws_ticket(user_id: str, session_id: str) -> str:
    """生成WebSocket一次性ticket"""
    import uuid
    import time
    ticket = str(uuid.uuid4())
    ws_tickets[ticket] = {
        "user_id": user_id,
        "session_id": session_id,
        "expires_at": time.time() + 60,  # 60秒过期
    }
    return ticket

@router.get("/{session_id}/ws-ticket")
async def get_ws_ticket(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取WebSocket一次性ticket"""
    session = db.query(VoiceSession).filter(VoiceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此会话")

    ticket = generate_ws_ticket(current_user.id, session_id)
    return {"ticket": ticket}

@router.websocket("/ws/{session_id}")
async def voice_websocket(
    websocket: WebSocket,
    session_id: str,
    ticket: str = None,
):
    """实时语音WebSocket通道

    连接时需要传递 ticket 参数: ws://host/api/voice-chat/ws/{session_id}?ticket=xxx
    ticket 通过 GET /api/voice-chat/{session_id}/ws-ticket 获取
    """
    import time

    # 验证 ticket
    if not ticket:
        ticket = websocket.query_params.get("ticket")

    if not ticket or ticket not in ws_tickets:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "无效的ticket"})
        await websocket.close()
        return

    ticket_data = ws_tickets.pop(ticket)  # 一次性使用
    user_id = ticket_data["user_id"]

    # 检查过期
    if time.time() > ticket_data["expires_at"]:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "ticket已过期"})
        await websocket.close()
        return

    # 验证session归属
    if ticket_data["session_id"] != session_id:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": "ticket与session不匹配"})
        await websocket.close()
        return

    await websocket.accept()

    # 获取数据库会话
    db = SessionLocal()

    try:
        # 验证会话
        session = db.query(VoiceSession).filter(VoiceSession.id == session_id).first()
        if not session:
            await websocket.send_json({"type": "error", "message": "会话不存在"})
            await websocket.close()
            return

        # 验证会话归属
        if session.user_id != user_id:
            await websocket.send_json({"type": "error", "message": "无权访问此会话"})
            await websocket.close()
            return

        # 获取角色信息
        character = db.query(CharacterDB).filter(CharacterDB.id == session.character_id).first()
        if not character:
            await websocket.send_json({"type": "error", "message": "角色不存在"})
            await websocket.close()
            return

        # 构建系统提示词
        system_prompt = character.system_prompt or f"你是{character.name}。{character.description or ''}"

        # 发送连接成功消息
        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
            "character_name": character.name,
        })

        # 音频缓冲区
        audio_buffer = bytearray()
        is_speaking = False
        is_interrupted = False

        # 对话历史
        conversation_history = []

        while True:
            try:
                # 接收消息
                data = await websocket.receive_json()

                if data.get("type") == "audio_chunk":
                    # 接收音频片段
                    chunk = base64.b64decode(data.get("data", ""))
                    audio_buffer.extend(chunk)

                elif data.get("type") == "vad_start":
                    # VAD检测到语音开始
                    is_speaking = True
                    is_interrupted = False
                    audio_buffer.clear()

                elif data.get("type") == "vad_end":
                    # VAD检测到语音结束
                    is_speaking = False

                    if len(audio_buffer) > 0:
                        # 保存音频到临时文件
                        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                            tmp.write(bytes(audio_buffer))
                            tmp_path = tmp.name

                        try:
                            # STT识别
                            if stt_service:
                                await websocket.send_json({"type": "stt_processing"})
                                user_text = stt_service.transcribe(tmp_path)
                            else:
                                user_text = "（语音识别服务未启用）"

                            # 发送STT结果
                            await websocket.send_json({
                                "type": "stt_final",
                                "text": user_text,
                            })

                            # 保存用户消息
                            user_msg = VoiceMessage(
                                voice_session_id=session_id,
                                role="user",
                                text=user_text,
                            )
                            db.add(user_msg)

                            # 构建LLM消息
                            conversation_history.append({"role": "user", "content": user_text})

                            # 调用LLM
                            await websocket.send_json({"type": "ai_thinking"})

                            if llm_service:
                                messages = [
                                    {"role": "system", "content": system_prompt},
                                ] + conversation_history[-10:]  # 保留最近10轮

                                ai_text = llm_service.chat(messages, max_tokens=200, temperature=0.8)
                            else:
                                ai_text = f"我是{character.name}，你好！"

                            # 检查是否被打断
                            if is_interrupted:
                                ai_text = ai_text[:50] + "..."  # 截断

                            # 发送AI回复
                            await websocket.send_json({
                                "type": "ai_response",
                                "text": ai_text,
                            })

                            # 保存AI消息
                            ai_msg = VoiceMessage(
                                voice_session_id=session_id,
                                role="assistant",
                                text=ai_text,
                                interrupted=is_interrupted,
                            )
                            db.add(ai_msg)

                            # 添加到对话历史
                            conversation_history.append({"role": "assistant", "content": ai_text})

                            # TTS合成
                            if tts_service and character:
                                try:
                                    # 获取TTS配置
                                    tts_config = {}
                                    if hasattr(character, 'tts_enabled'):
                                        tts_config = {
                                            "enabled": character.tts_enabled,
                                            "model": character.tts_model or "mimo-v2.5-tts-voiceclone",
                                            "voice": character.tts_voice or "冰糖",
                                            "style_prompt": character.tts_style_prompt or "",
                                        }

                                    # 合成语音
                                    audio_data = tts_service.synthesize(ai_text, tts_config)

                                    if audio_data:
                                        # 保存音频文件
                                        audio_filename = f"voice_{session_id}_{len(conversation_history)}.wav"
                                        audio_path = AUDIO_CACHE_DIR / audio_filename
                                        with open(audio_path, "wb") as f:
                                            f.write(audio_data)

                                        # 发送音频URL
                                        await websocket.send_json({
                                            "type": "tts_audio",
                                            "audio_url": f"/audio/{audio_filename}",
                                        })

                                        # 更新消息音频URL
                                        ai_msg.audio_url = f"/audio/{audio_filename}"
                                except Exception as e:
                                    print(f"TTS合成失败: {e}")

                            # 发送完成
                            await websocket.send_json({"type": "turn_complete"})

                        finally:
                            # 清理临时文件
                            try:
                                os.unlink(tmp_path)
                            except:
                                pass

                        audio_buffer.clear()

                elif data.get("type") == "interrupt":
                    # 用户打断
                    is_interrupted = True
                    await websocket.send_json({"type": "interrupted"})

                elif data.get("type") == "text":
                    # 文本输入（备选）
                    user_text = data.get("content", "")
                    if user_text:
                        # 发送STT结果
                        await websocket.send_json({
                            "type": "stt_final",
                            "text": user_text,
                        })

                        # 保存用户消息
                        user_msg = VoiceMessage(
                            voice_session_id=session_id,
                            role="user",
                            text=user_text,
                        )
                        db.add(user_msg)

                        # 构建LLM消息
                        conversation_history.append({"role": "user", "content": user_text})

                        # 调用LLM
                        await websocket.send_json({"type": "ai_thinking"})

                        if llm_service:
                            messages = [
                                {"role": "system", "content": system_prompt},
                            ] + conversation_history[-10:]

                            ai_text = llm_service.chat(messages, max_tokens=200, temperature=0.8)
                        else:
                            ai_text = f"我是{character.name}，你好！"

                        # 发送AI回复
                        await websocket.send_json({
                            "type": "ai_response",
                            "text": ai_text,
                        })

                        # 保存AI消息
                        ai_msg = VoiceMessage(
                            voice_session_id=session_id,
                            role="assistant",
                            text=ai_text,
                        )
                        db.add(ai_msg)

                        # 添加到对话历史
                        conversation_history.append({"role": "assistant", "content": ai_text})

                        # TTS合成
                        if tts_service and character:
                            try:
                                tts_config = {}
                                if hasattr(character, 'tts_enabled'):
                                    tts_config = {
                                        "enabled": character.tts_enabled,
                                        "model": character.tts_model or "mimo-v2.5-tts-voiceclone",
                                        "voice": character.tts_voice or "冰糖",
                                        "style_prompt": character.tts_style_prompt or "",
                                    }

                                audio_data = tts_service.synthesize(ai_text, tts_config)

                                if audio_data:
                                    audio_filename = f"voice_{session_id}_{len(conversation_history)}.wav"
                                    audio_path = AUDIO_CACHE_DIR / audio_filename
                                    with open(audio_path, "wb") as f:
                                        f.write(audio_data)

                                    await websocket.send_json({
                                        "type": "tts_audio",
                                        "audio_url": f"/audio/{audio_filename}",
                                    })

                                    ai_msg.audio_url = f"/audio/{audio_filename}"
                            except Exception as e:
                                print(f"TTS合成失败: {e}")

                        # 发送完成
                        await websocket.send_json({"type": "turn_complete"})

                db.commit()

            except WebSocketDisconnect:
                break
            except Exception as e:
                print(f"WebSocket错误: {e}")
                await websocket.send_json({"type": "error", "message": str(e)})

    finally:
        # 更新会话状态
        try:
            session.status = "ended"
            db.commit()
        except:
            pass

        db.close()
        try:
            await websocket.close()
        except:
            pass
