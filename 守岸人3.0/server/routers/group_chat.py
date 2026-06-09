# -*- coding: utf-8 -*-
"""群聊路由"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from pathlib import Path
from ..database import get_db
from ..models.user import User
from ..models.group_chat_db import GroupSession, GroupMember, GroupMessage
from ..models.character_db import CharacterDB
from ..middleware.auth import get_current_user
from ..services.llm_service import LLMService
import json
import random

router = APIRouter(prefix="/api/group-chat", tags=["group-chat"])

# LLM服务实例（会在init中设置）
llm_service = None

def init_router(llm: LLMService):
    global llm_service
    llm_service = llm

class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    character_ids: List[str]
    turn_order: Optional[str] = "round_robin"  # round_robin, random, triggered, user_pick

class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    turn_order: Optional[str] = None

class MemberAdd(BaseModel):
    character_id: str

class MemberReorder(BaseModel):
    items: List[dict]  # [{character_id, sort_order}]

class MessageSend(BaseModel):
    text: str
    mention_char_ids: Optional[List[str]] = None

# ========== 群聊管理 ==========

@router.get("")
async def get_groups(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户的群聊列表"""
    groups = db.query(GroupSession).filter(
        GroupSession.user_id == current_user.id
    ).order_by(GroupSession.updated_at.desc()).all()

    result = []
    for g in groups:
        data = g.to_dict()
        # 获取成员数量
        member_count = db.query(GroupMember).filter(
            GroupMember.group_id == g.id
        ).count()
        data["member_count"] = member_count
        result.append(data)

    return result

@router.post("")
async def create_group(
    req: GroupCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建群聊"""
    if not req.character_ids:
        raise HTTPException(status_code=400, detail="至少选择一个角色")

    # 创建群聊
    group = GroupSession(
        user_id=current_user.id,
        name=req.name,
        description=req.description,
        turn_order=req.turn_order,
    )
    db.add(group)
    db.flush()

    # 添加成员
    for i, char_id in enumerate(req.character_ids):
        member = GroupMember(
            group_id=group.id,
            character_id=char_id,
            sort_order=i,
        )
        db.add(member)

    db.commit()
    db.refresh(group)

    return group.to_dict()

@router.get("/{group_id}")
async def get_group(
    group_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取群聊详情"""
    group = db.query(GroupSession).filter(GroupSession.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    if group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此群聊")

    data = group.to_dict()

    # 获取成员列表
    members = db.query(GroupMember).filter(
        GroupMember.group_id == group_id
    ).order_by(GroupMember.sort_order).all()

    data["members"] = []
    for m in members:
        member_data = m.to_dict()
        # 获取角色信息（先查数据库，再查JSON文件）
        character = db.query(CharacterDB).filter(CharacterDB.id == m.character_id).first()
        if character:
            member_data["character_name"] = character.name
            member_data["character_avatar"] = character.avatar_url
        else:
            # 尝试从JSON文件加载
            from ..models.character import Character as CharacterFile
            char_path = Path(__file__).parent.parent.parent / "data" / "characters" / f"{m.character_id}.json"
            if char_path.exists():
                try:
                    char_file = CharacterFile.load(char_path)
                    member_data["character_name"] = char_file.name
                    member_data["character_avatar"] = char_file.avatar
                except:
                    member_data["character_name"] = "未知角色"
            else:
                member_data["character_name"] = "未知角色"
        data["members"].append(member_data)

    return data

@router.put("/{group_id}")
async def update_group(
    group_id: str,
    req: GroupUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新群聊设置"""
    group = db.query(GroupSession).filter(GroupSession.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    if group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权修改此群聊")

    if req.name is not None:
        group.name = req.name
    if req.description is not None:
        group.description = req.description
    if req.turn_order is not None:
        group.turn_order = req.turn_order

    db.commit()
    db.refresh(group)
    return group.to_dict()

@router.delete("/{group_id}")
async def delete_group(
    group_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除群聊"""
    group = db.query(GroupSession).filter(GroupSession.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    if group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除此群聊")

    # 删除相关数据
    db.query(GroupMessage).filter(GroupMessage.group_id == group_id).delete()
    db.query(GroupMember).filter(GroupMember.group_id == group_id).delete()
    db.delete(group)
    db.commit()

    return {"message": "删除成功"}

# ========== 成员管理 ==========

@router.post("/{group_id}/members")
async def add_member(
    group_id: str,
    req: MemberAdd,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """添加成员"""
    group = db.query(GroupSession).filter(GroupSession.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    if group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权修改此群聊")

    # 检查角色是否存在
    character = db.query(CharacterDB).filter(CharacterDB.id == req.character_id).first()
    if not character:
        raise HTTPException(status_code=404, detail="角色不存在")

    # 检查是否已经是成员
    existing = db.query(GroupMember).filter(
        GroupMember.group_id == group_id,
        GroupMember.character_id == req.character_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="该角色已在群聊中")

    # 获取当前最大排序
    max_order = db.query(GroupMember).filter(
        GroupMember.group_id == group_id
    ).count()

    member = GroupMember(
        group_id=group_id,
        character_id=req.character_id,
        sort_order=max_order,
    )
    db.add(member)
    db.commit()

    return {"message": "添加成功"}

@router.delete("/{group_id}/members/{character_id}")
async def remove_member(
    group_id: str,
    character_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """移除成员"""
    group = db.query(GroupSession).filter(GroupSession.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    if group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权修改此群聊")

    member = db.query(GroupMember).filter(
        GroupMember.group_id == group_id,
        GroupMember.character_id == character_id
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")

    db.delete(member)
    db.commit()

    return {"message": "移除成功"}

@router.put("/{group_id}/members/reorder")
async def reorder_members(
    group_id: str,
    req: MemberReorder,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """重新排序成员"""
    group = db.query(GroupSession).filter(GroupSession.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    if group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权修改此群聊")

    for item in req.items:
        member = db.query(GroupMember).filter(
            GroupMember.group_id == group_id,
            GroupMember.character_id == item["character_id"]
        ).first()
        if member:
            member.sort_order = item["sort_order"]

    db.commit()
    return {"message": "排序成功"}

# ========== 消息 ==========

@router.get("/{group_id}/messages")
async def get_messages(
    group_id: str,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取群聊消息"""
    group = db.query(GroupSession).filter(GroupSession.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    if group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此群聊")

    messages = db.query(GroupMessage).filter(
        GroupMessage.group_id == group_id
    ).order_by(GroupMessage.created_at.desc()).limit(limit).all()

    result = []
    for msg in reversed(messages):
        data = msg.to_dict()
        # 如果是角色发言，获取角色信息
        if msg.character_id:
            character = db.query(CharacterDB).filter(CharacterDB.id == msg.character_id).first()
            if character:
                data["character_name"] = character.name
                data["character_avatar"] = character.avatar_url
            else:
                # 尝试从JSON文件加载
                from ..models.character import Character as CharacterFile
                char_path = Path(__file__).parent.parent.parent / "data" / "characters" / f"{msg.character_id}.json"
                if char_path.exists():
                    try:
                        char_file = CharacterFile.load(char_path)
                        data["character_name"] = char_file.name
                        data["character_avatar"] = char_file.avatar
                    except:
                        data["character_name"] = "未知角色"
                else:
                    data["character_name"] = "未知角色"
        result.append(data)

    return result

@router.post("/{group_id}/send")
async def send_message(
    group_id: str,
    req: MessageSend,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """发送消息"""
    group = db.query(GroupSession).filter(GroupSession.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="群聊不存在")
    if group.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此群聊")

    # 保存用户消息
    user_msg = GroupMessage(
        group_id=group_id,
        role="user",
        content={
            "text": req.text,
            "mentions": req.mention_char_ids or [],
        },
    )
    db.add(user_msg)
    db.flush()

    # 获取活跃成员
    members = db.query(GroupMember).filter(
        GroupMember.group_id == group_id,
        GroupMember.is_active == True
    ).order_by(GroupMember.sort_order).all()

    if not members:
        db.commit()
        return {"messages": [user_msg.to_dict()]}

    # 根据发言顺序策略决定哪些角色回复
    MAX_REPLY_CHARACTERS = 3  # 最多3个角色回复
    responding_members = []

    if group.turn_order == "triggered":
        # 仅被@的角色回复
        if req.mention_char_ids:
            responding_members = [m for m in members if m.character_id in req.mention_char_ids]
        else:
            # 没有@任何人，随机选一个
            responding_members = [random.choice(members)]
    elif group.turn_order == "random":
        # 随机选1-2个
        count = min(random.randint(1, 2), len(members))
        responding_members = random.sample(members, count)
    elif group.turn_order == "user_pick":
        # 等待用户手动选择（这里简化为第一个）
        responding_members = [members[0]]
    else:
        # round_robin: 最多MAX_REPLY_CHARACTERS个角色回复
        responding_members = members[:MAX_REPLY_CHARACTERS]

    # 并发调用LLM
    response_messages = []

    for member in responding_members:
        # 获取角色信息（先查数据库，再查JSON文件）
        character = db.query(CharacterDB).filter(CharacterDB.id == member.character_id).first()
        char_name = "未知角色"
        char_system_prompt = ""
        char_description = ""

        if character:
            char_name = character.name
            char_system_prompt = character.system_prompt or ""
            char_description = character.description or ""
        else:
            # 尝试从JSON文件加载
            from ..models.character import Character as CharacterFile
            char_path = Path(__file__).parent.parent.parent / "data" / "characters" / f"{member.character_id}.json"
            if char_path.exists():
                try:
                    char_file = CharacterFile.load(char_path)
                    char_name = char_file.name
                    char_system_prompt = char_file.system_prompt or ""
                    char_description = char_file.description or ""
                except:
                    continue
            else:
                continue

        # 构建提示词
        system_prompt = build_group_prompt_from_info(char_name, char_system_prompt, char_description, members, db)

        # 获取最近消息作为上下文
        recent_msgs = db.query(GroupMessage).filter(
            GroupMessage.group_id == group_id
        ).order_by(GroupMessage.created_at.desc()).limit(20).all()

        history = ""
        for msg in reversed(recent_msgs):
            if msg.role == "user":
                history += f"\n[用户] {msg.content.get('text', '')}"
            elif msg.role == "character" and msg.character_id:
                char = db.query(CharacterDB).filter(CharacterDB.id == msg.character_id).first()
                char_name = char.name if char else "未知"
                history += f"\n[{char_name}] {msg.content.get('text', '')}"

        prompt = f"""群聊中有人说："{req.text}"

最近的对话：
{history[-800:]}

请以{char_name}的身份回复，保持角色性格。回复要简短自然（50-100字）。"""

        try:
            if llm_service:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ]
                response_text = llm_service.chat(messages, max_tokens=200, temperature=0.8)
            else:
                response_text = f"我是{char_name}，你好！"
        except Exception as e:
            print(f"LLM调用失败: {e}")
            response_text = f"我是{char_name}，你好！"

        # 保存角色回复
        char_msg = GroupMessage(
            group_id=group_id,
            character_id=member.character_id,
            role="character",
            content={"text": response_text},
            turn_index=len(response_messages),
        )
        db.add(char_msg)
        response_messages.append(char_msg)

    db.commit()

    # 返回所有新消息
    result = [user_msg.to_dict()]
    for msg in response_messages:
        db.refresh(msg)
        data = msg.to_dict()
        # 获取角色名称
        character = db.query(CharacterDB).filter(CharacterDB.id == msg.character_id).first()
        if character:
            data["character_name"] = character.name
            data["character_avatar"] = character.avatar_url
        else:
            # 尝试从JSON文件加载
            from ..models.character import Character as CharacterFile
            char_path = Path(__file__).parent.parent.parent / "data" / "characters" / f"{msg.character_id}.json"
            if char_path.exists():
                try:
                    char_file = CharacterFile.load(char_path)
                    data["character_name"] = char_file.name
                    data["character_avatar"] = char_file.avatar
                except:
                    data["character_name"] = "未知角色"
            else:
                data["character_name"] = "未知角色"
        result.append(data)

    return {"messages": result}

def build_group_prompt(character, members, db):
    """构建群聊系统提示词（从CharacterDB对象）"""
    other_chars = []
    for m in members:
        if m.character_id != character.id:
            char = db.query(CharacterDB).filter(CharacterDB.id == m.character_id).first()
            if char:
                other_chars.append(char.name)
            else:
                # 尝试从JSON文件加载
                char_path = Path(__file__).parent.parent.parent / "data" / "characters" / f"{m.character_id}.json"
                if char_path.exists():
                    try:
                        from ..models.character import Character as CharacterFile
                        char_file = CharacterFile.load(char_path)
                        other_chars.append(char_file.name)
                    except:
                        pass

    prompt = f"""你是{character.name}。

你的人设：
{character.system_prompt or character.description or ''}

你正在一个群聊中，群里还有：{', '.join(other_chars) if other_chars else '无其他人'}。

规则：
1. 保持你的角色性格
2. 回复要简短自然（50-100字）
3. 可以和其他角色互动
4. 不要打破角色"""

    return prompt


def build_group_prompt_from_info(char_name, char_system_prompt, char_description, members, db):
    """构建群聊系统提示词（从角色信息直接构建）"""
    other_chars = []
    for m in members:
        # 获取其他角色名称
        char = db.query(CharacterDB).filter(CharacterDB.id == m.character_id).first()
        if char:
            if char.name != char_name:
                other_chars.append(char.name)
        else:
            # 尝试从JSON文件加载
            char_path = Path(__file__).parent.parent.parent / "data" / "characters" / f"{m.character_id}.json"
            if char_path.exists():
                try:
                    from ..models.character import Character as CharacterFile
                    char_file = CharacterFile.load(char_path)
                    if char_file.name != char_name:
                        other_chars.append(char_file.name)
                except:
                    pass

    prompt = f"""你是{char_name}。

你的人设：
{char_system_prompt or char_description or ''}

你正在一个群聊中，群里还有：{', '.join(other_chars) if other_chars else '无其他人'}。

规则：
1. 保持你的角色性格
2. 回复要简短自然（50-100字）
3. 可以和其他角色互动
4. 不要打破角色"""

    return prompt
