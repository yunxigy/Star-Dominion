# -*- coding: utf-8 -*-
"""长期记忆路由"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from ..database import get_db
from ..models.user import User
from ..models.memory import Memory, MemorySummary
from ..middleware.auth import get_current_user
from ..services.llm_service import LLMService

router = APIRouter(prefix="/api/memories", tags=["memories"])

llm_service = None

def init_router(llm: LLMService):
    global llm_service
    llm_service = llm


class MemoryCreate(BaseModel):
    character_id: str
    content: str
    importance: Optional[float] = 0.5

class MemoryUpdate(BaseModel):
    content: Optional[str] = None
    importance: Optional[float] = None
    is_active: Optional[bool] = None


@router.get("/{character_id}")
async def get_memories(
    character_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户对某角色的所有记忆"""
    memories = db.query(Memory).filter(
        Memory.user_id == current_user.id,
        Memory.character_id == character_id,
        Memory.is_active == True,
    ).order_by(Memory.importance.desc()).all()
    return [m.to_dict() for m in memories]


@router.post("")
async def create_memory(
    req: MemoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """手动创建记忆"""
    memory = Memory(
        user_id=current_user.id,
        character_id=req.character_id,
        content=req.content,
        importance=req.importance,
        source="manual",
    )
    db.add(memory)
    db.commit()
    db.refresh(memory)
    return memory.to_dict()


@router.put("/{memory_id}")
async def update_memory(
    memory_id: str,
    req: MemoryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新记忆"""
    memory = db.query(Memory).filter(
        Memory.id == memory_id,
        Memory.user_id == current_user.id,
    ).first()
    if not memory:
        raise HTTPException(status_code=404, detail="记忆不存在")

    if req.content is not None:
        memory.content = req.content
    if req.importance is not None:
        memory.importance = req.importance
    if req.is_active is not None:
        memory.is_active = req.is_active

    db.commit()
    db.refresh(memory)
    return memory.to_dict()


@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除记忆"""
    memory = db.query(Memory).filter(
        Memory.id == memory_id,
        Memory.user_id == current_user.id,
    ).first()
    if not memory:
        raise HTTPException(status_code=404, detail="记忆不存在")

    db.delete(memory)
    db.commit()
    return {"message": "删除成功"}


@router.get("/{character_id}/summaries")
async def get_summaries(
    character_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取对话摘要"""
    summaries = db.query(MemorySummary).filter(
        MemorySummary.user_id == current_user.id,
        MemorySummary.character_id == character_id,
    ).order_by(MemorySummary.created_at.desc()).limit(10).all()
    return [s.to_dict() for s in summaries]


async def extract_memories(user_id: str, character_id: str, messages: list, db: Session):
    """从对话中提取记忆（带错误隔离）"""
    if not llm_service or len(messages) < 6:
        return

    try:
        # 构建提取提示词
        conversation = ""
        for msg in messages[-10:]:
            role = "用户" if msg["role"] == "user" else "AI"
            content = msg.get("content", "")
            if isinstance(content, dict):
                content = content.get("text", "")
            conversation += f"{role}: {content}\n"

        prompt = f"""从以下对话中提取关于用户的重要信息（最多3条），用于未来的对话参考。

对话内容：
{conversation}

请提取：
1. 用户的个人信息（名字、年龄、职业等）
2. 用户的偏好、兴趣
3. 用户提到的重要事件或经历

输出格式（每条一行，不要编号）：
记忆内容1
记忆内容2
记忆内容3

如果没有值得记住的信息，输出"无"。"""

        response = llm_service.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=200,
            temperature=0.3,
        )

        if response and "无" not in response:
            for line in response.strip().split('\n'):
                line = line.strip()
                if line and len(line) > 5:
                    # 检查是否已存在类似记忆
                    existing = db.query(Memory).filter(
                        Memory.user_id == user_id,
                        Memory.character_id == character_id,
                        Memory.content.contains(line[:20]),
                    ).first()

                    if not existing:
                        memory = Memory(
                            user_id=user_id,
                            character_id=character_id,
                            content=line,
                            importance=0.6,
                            source="extract",
                        )
                        db.add(memory)

            db.commit()
    except Exception as e:
        logging.getLogger(__name__).error(f"记忆提取失败: {e}")


async def create_summary(user_id: str, character_id: str, session_id: str, messages: list, db: Session):
    """创建对话摘要（带错误隔离）"""
    if not llm_service or len(messages) < 10:
        return

    try:
        conversation = ""
        for msg in messages:
            role = "用户" if msg["role"] == "user" else "AI"
            content = msg.get("content", "")
            if isinstance(content, dict):
                content = content.get("text", "")
            conversation += f"{role}: {content}\n"

        prompt = f"""请将以下对话总结为一段简短的摘要（50-100字），保留关键信息。

对话内容：
{conversation}

摘要："""

        response = llm_service.chat(
            [{"role": "user", "content": prompt}],
            max_tokens=150,
            temperature=0.3,
        )

        if response:
            summary = MemorySummary(
                user_id=user_id,
                character_id=character_id,
                session_id=session_id,
                summary=response.strip(),
                message_count=len(messages),
            )
            db.add(summary)
            db.commit()
    except Exception as e:
        logging.getLogger(__name__).error(f"摘要创建失败: {e}")
