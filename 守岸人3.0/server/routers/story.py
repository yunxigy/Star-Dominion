# -*- coding: utf-8 -*-
"""剧情模式路由"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from pydantic import BaseModel
from typing import Optional, List
from ..database import get_db
from ..models.user import User
from ..models.story import (
    Story, StorySession, StoryMessage,
    StoryFavorite, StoryRating, StoryBranch,
    generate_share_code
)
from ..middleware.auth import get_current_user
from ..services.nsfw_filter import NSFWFilter
from ..services.llm_service import LLMService
import json
import os
from pathlib import Path

router = APIRouter(prefix="/api/stories", tags=["stories"])

# LLM服务实例（会在init中设置）
llm_service = None

# 封面图存储目录
COVERS_DIR = Path(__file__).parent.parent.parent / "data" / "stories" / "covers"

def init_router(llm: LLMService):
    global llm_service
    llm_service = llm
    # 创建封面目录
    COVERS_DIR.mkdir(parents=True, exist_ok=True)

class StoryCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    background: str
    task: str
    protagonist: Optional[str] = ""
    system_prompt: str
    tags: Optional[List[str]] = []
    character_id: Optional[str] = None

class SessionCreate(BaseModel):
    story_id: str
    protagonist_name: Optional[str] = "主角"
    protagonist_desc: Optional[str] = ""
    character_id: Optional[str] = None

class MessageCreate(BaseModel):
    session_id: str
    content: Optional[str] = None  # 自定义输入
    option_index: Optional[int] = None  # 选择的选项索引

class RatingCreate(BaseModel):
    rating: int  # 1-5

class OutlineRequest(BaseModel):
    title: str
    description: Optional[str] = ""
    tags: Optional[List[str]] = []

# ========== 故事管理 ==========

@router.get("")
async def get_stories(
    nsfw: Optional[bool] = None,
    tag: Optional[str] = None,
    sort: Optional[str] = "newest",  # newest, rating, popular
    include_private: Optional[bool] = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取故事列表"""
    nsfw_filter = NSFWFilter(db)
    query = db.query(Story)

    # 权限过滤：公开故事 + 自己的私有故事
    if include_private and current_user:
        query = query.filter(
            (Story.is_public == True) | (Story.creator_id == current_user.id)
        )
    else:
        query = query.filter(Story.is_public == True)

    if tag:
        query = query.filter(Story.tags.contains([tag]))

    # 排序
    if sort == "rating":
        query = query.order_by(Story.rating_avg.desc())
    elif sort == "popular":
        query = query.order_by(Story.rating_count.desc())
    else:
        query = query.order_by(Story.created_at.desc())

    stories = query.all()
    result = [s.to_dict() for s in stories]

    if nsfw is not True and not nsfw_filter.enabled:
        result = [s for s in result if not s.get("is_nsfw")]

    return result

@router.get("/{story_id}")
async def get_story(story_id: str, db: Session = Depends(get_db)):
    """获取故事详情"""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")
    return story.to_dict(include_details=True)

@router.post("")
async def create_story(
    req: StoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """创建故事"""
    story = Story(
        title=req.title,
        description=req.description,
        background=req.background,
        task=req.task,
        protagonist=req.protagonist,
        system_prompt=req.system_prompt,
        tags=req.tags,
        character_id=req.character_id,
        creator_id=current_user.id,
    )
    db.add(story)
    db.commit()
    db.refresh(story)
    return story.to_dict()

@router.put("/{story_id}")
async def update_story(
    story_id: str,
    req: StoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """更新故事"""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")
    if story.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="无权修改此故事")

    story.title = req.title
    story.description = req.description
    story.background = req.background
    story.task = req.task
    story.protagonist = req.protagonist
    story.system_prompt = req.system_prompt
    story.tags = req.tags
    story.character_id = req.character_id
    db.commit()
    db.refresh(story)
    return story.to_dict()

@router.delete("/{story_id}")
async def delete_story(
    story_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除故事"""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")
    if story.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="无权删除此故事")

    # 删除相关数据
    sessions = db.query(StorySession).filter(StorySession.story_id == story_id).all()
    for session in sessions:
        db.query(StoryMessage).filter(StoryMessage.session_id == session.id).delete()
        db.query(StoryBranch).filter(StoryBranch.session_id == session.id).delete()
    db.query(StorySession).filter(StorySession.story_id == story_id).delete()
    db.query(StoryFavorite).filter(StoryFavorite.story_id == story_id).delete()
    db.query(StoryRating).filter(StoryRating.story_id == story_id).delete()
    db.delete(story)
    db.commit()

    return {"message": "删除成功"}

# ========== 封面上传 ==========

@router.post("/{story_id}/cover")
async def upload_cover(
    story_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """上传封面图"""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")
    if story.creator_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="无权修改此故事")

    # 验证文件类型
    allowed_types = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="只支持 png/jpg/jpeg/webp 格式")

    # 保存文件
    ext = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    filename = f"{story_id}.{ext}"
    file_path = COVERS_DIR / filename

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # 更新数据库
    story.cover_url = f"/static/stories/covers/{filename}"
    db.commit()

    return {"cover_url": story.cover_url}

# ========== 收藏功能 ==========

@router.post("/{story_id}/favorite")
async def toggle_favorite(
    story_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """收藏/取消收藏"""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")

    existing = db.query(StoryFavorite).filter(
        StoryFavorite.user_id == current_user.id,
        StoryFavorite.story_id == story_id
    ).first()

    if existing:
        db.delete(existing)
        db.commit()
        return {"favorited": False}
    else:
        favorite = StoryFavorite(user_id=current_user.id, story_id=story_id)
        db.add(favorite)
        db.commit()
        return {"favorited": True}

@router.get("/{story_id}/favorite")
async def check_favorite(
    story_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """检查是否已收藏"""
    existing = db.query(StoryFavorite).filter(
        StoryFavorite.user_id == current_user.id,
        StoryFavorite.story_id == story_id
    ).first()
    return {"favorited": existing is not None}

@router.get("/user/favorites")
async def get_user_favorites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户收藏的剧情"""
    favorites = db.query(StoryFavorite).filter(
        StoryFavorite.user_id == current_user.id
    ).order_by(StoryFavorite.created_at.desc()).all()

    result = []
    for fav in favorites:
        story = db.query(Story).filter(Story.id == fav.story_id).first()
        if story:
            data = story.to_dict()
            data["favorited_at"] = fav.created_at.isoformat() if fav.created_at else None
            result.append(data)

    return result

# ========== 评分功能 ==========

@router.post("/{story_id}/rate")
async def rate_story(
    story_id: str,
    req: RatingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """评分"""
    if req.rating < 1 or req.rating > 5:
        raise HTTPException(status_code=400, detail="评分范围为1-5")

    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")

    existing = db.query(StoryRating).filter(
        StoryRating.user_id == current_user.id,
        StoryRating.story_id == story_id
    ).first()

    if existing:
        existing.rating = req.rating
    else:
        rating = StoryRating(
            user_id=current_user.id,
            story_id=story_id,
            rating=req.rating
        )
        db.add(rating)

    # 更新平均评分
    db.commit()
    avg_rating = db.query(sql_func.avg(StoryRating.rating)).filter(
        StoryRating.story_id == story_id
    ).scalar()
    count = db.query(sql_func.count(StoryRating.id)).filter(
        StoryRating.story_id == story_id
    ).scalar()

    story.rating_avg = round(float(avg_rating or 0), 1)
    story.rating_count = count or 0
    db.commit()

    return {
        "rating": req.rating,
        "rating_avg": story.rating_avg,
        "rating_count": story.rating_count
    }

@router.get("/{story_id}/rate")
async def get_user_rating(
    story_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户评分"""
    existing = db.query(StoryRating).filter(
        StoryRating.user_id == current_user.id,
        StoryRating.story_id == story_id
    ).first()
    return {"rating": existing.rating if existing else None}

# ========== 分享码 ==========

@router.post("/{story_id}/share")
async def generate_story_share_code(
    story_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """生成分享码"""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")

    if not story.share_code:
        story.share_code = generate_share_code()
        db.commit()

    return {"share_code": story.share_code}

@router.get("/share/{code}")
async def get_story_by_share_code(
    code: str,
    db: Session = Depends(get_db)
):
    """通过分享码获取剧情"""
    story = db.query(Story).filter(Story.share_code == code).first()
    if not story:
        raise HTTPException(status_code=404, detail="分享码无效")
    return story.to_dict(include_details=True)

# ========== 导出功能 ==========

@router.get("/{story_id}/export")
async def export_story(
    story_id: str,
    format: str = "json",  # json 或 text
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """导出剧情"""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")

    if format == "text":
        # 文本格式
        text = f"# {story.title}\n\n"
        text += f"## 描述\n{story.description}\n\n"
        text += f"## 背景\n{story.background}\n\n"
        text += f"## 任务\n{story.task}\n\n"
        if story.protagonist:
            text += f"## 主角设定\n{story.protagonist}\n\n"
        if story.outline:
            text += f"## 大纲\n{story.outline}\n\n"
        return {"format": "text", "content": text}
    else:
        # JSON格式
        data = story.to_dict(include_details=True)
        data["sessions"] = []
        sessions = db.query(StorySession).filter(
            StorySession.story_id == story_id
        ).all()
        for session in sessions:
            session_data = session.to_dict()
            messages = db.query(StoryMessage).filter(
                StoryMessage.session_id == session.id
            ).order_by(StoryMessage.created_at).all()
            session_data["messages"] = [m.to_dict() for m in messages]
            data["sessions"].append(session_data)
        return {"format": "json", "content": data}

# ========== AI功能 ==========

@router.post("/generate-outline")
async def generate_outline(
    req: OutlineRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """AI自动生成大纲"""
    if not llm_service:
        raise HTTPException(status_code=500, detail="LLM服务未初始化")

    prompt = f"""根据以下信息生成一个详细的剧情大纲：

标题：{req.title}
描述：{req.description}
标签：{', '.join(req.tags) if req.tags else '无'}

请生成包含以下内容的大纲：
1. 世界观设定
2. 主要角色
3. 主线任务
4. 3-5个关键剧情节点
5. 可能的分支走向

输出格式：
【世界观】
...

【主要角色】
...

【主线任务】
...

【关键剧情节点】
1. ...
2. ...
3. ...

【分支走向】
1. ...
2. ..."""

    try:
        messages = [
            {"role": "system", "content": "你是一个专业的剧情设计师，擅长创作引人入胜的故事。"},
            {"role": "user", "content": prompt},
        ]
        response = llm_service.chat(messages, max_tokens=800, temperature=0.8)
        return {"outline": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成大纲失败: {str(e)}")

@router.post("/{story_id}/generate-options")
async def generate_options(
    story_id: str,
    session_id: str,
    count: int = 5,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """AI自动生成选项"""
    if not llm_service:
        raise HTTPException(status_code=500, detail="LLM服务未初始化")

    session = db.query(StorySession).filter(StorySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")

    # 获取最近的消息
    recent_messages = db.query(StoryMessage).filter(
        StoryMessage.session_id == session_id
    ).order_by(StoryMessage.created_at.desc()).limit(3).all()

    last_content = recent_messages[0].content if recent_messages else ""

    prompt = f"""根据当前剧情生成{count}个选项：

故事背景：{story.background[:200]}
当前场景：{last_content[:200]}

要求：
1. 选项要有意义，能推动剧情发展
2. 选项要多样化，包含不同方向
3. 每个选项15-30字

输出格式（直接列出选项，不要其他内容）：
1. 选项一
2. 选项二
..."""

    try:
        messages = [
            {"role": "system", "content": "你是一个互动剧情设计师。"},
            {"role": "user", "content": prompt},
        ]
        response = llm_service.chat(messages, max_tokens=300, temperature=0.9)

        # 解析选项
        options = []
        for line in response.strip().split('\n'):
            line = line.strip()
            if line and line[0].isdigit():
                option = line.lstrip('0123456789.、）) ').strip()
                if option:
                    options.append(option)

        return {"options": options[:count]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成选项失败: {str(e)}")

# ========== 分支图 ==========

@router.get("/sessions/{session_id}/branches")
async def get_branches(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取分支图数据"""
    session = db.query(StorySession).filter(StorySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此会话")

    branches = db.query(StoryBranch).filter(
        StoryBranch.session_id == session_id
    ).order_by(StoryBranch.depth, StoryBranch.created_at).all()

    return [b.to_dict() for b in branches]

# ========== 会话管理 ==========

@router.post("/sessions")
async def create_session(
    req: SessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """开始新剧情"""
    story = db.query(Story).filter(Story.id == req.story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="故事不存在")

    session = StorySession(
        user_id=current_user.id,
        story_id=req.story_id,
        character_id=req.character_id,
        protagonist_name=req.protagonist_name or "主角",
        protagonist_desc=req.protagonist_desc,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # 生成开场白和选项
    opening = await generate_opening(story, session)

    # 创建根分支节点
    root_branch = StoryBranch(
        session_id=session.id,
        parent_id=None,
        content=opening["content"][:200],
        choice_text="剧情开始",
        depth=0,
    )
    db.add(root_branch)
    db.commit()
    db.refresh(root_branch)

    # 保存旁白消息
    msg = StoryMessage(
        session_id=session.id,
        role="narrator",
        content=opening["content"],
        options=opening["options"],
        branch_id=root_branch.id,
        parent_branch_id=None,
    )
    db.add(msg)

    session.current_branch_id = root_branch.id
    db.commit()

    return {
        "session": session.to_dict(),
        "message": msg.to_dict(),
    }

@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: Session = Depends(get_db)):
    """获取会话详情"""
    session = db.query(StorySession).filter(StorySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    return session.to_dict()

@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str, db: Session = Depends(get_db)):
    """获取会话消息"""
    messages = db.query(StoryMessage).filter(
        StoryMessage.session_id == session_id
    ).order_by(StoryMessage.created_at).all()
    return [m.to_dict() for m in messages]

@router.get("/user/sessions")
async def get_user_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """获取用户的剧情会话"""
    sessions = db.query(StorySession).filter(
        StorySession.user_id == current_user.id
    ).order_by(StorySession.updated_at.desc()).all()

    result = []
    for s in sessions:
        story = db.query(Story).filter(Story.id == s.story_id).first()
        data = s.to_dict()
        data["story_title"] = story.title if story else "未知故事"
        result.append(data)

    return result

@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """删除剧情会话"""
    session = db.query(StorySession).filter(StorySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权删除此会话")

    # 删除相关数据
    db.query(StoryMessage).filter(StoryMessage.session_id == session_id).delete()
    db.query(StoryBranch).filter(StoryBranch.session_id == session_id).delete()
    db.delete(session)
    db.commit()

    return {"message": "删除成功"}

# ========== 对话交互 ==========

@router.post("/messages")
async def send_message(
    req: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """发送消息/选择选项"""
    session = db.query(StorySession).filter(StorySession.id == req.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此会话")

    story = db.query(Story).filter(Story.id == session.story_id).first()

    # 获取上一条消息的选项
    last_msg = db.query(StoryMessage).filter(
        StoryMessage.session_id == session.id
    ).order_by(StoryMessage.created_at.desc()).first()

    # 确定用户的选择
    user_choice = ""
    if req.option_index is not None and last_msg and last_msg.options:
        if 0 <= req.option_index < len(last_msg.options):
            user_choice = last_msg.options[req.option_index]
            # 更新上一条消息的选择记录
            last_msg.chosen_option = user_choice
    elif req.content:
        user_choice = req.content

    if not user_choice:
        raise HTTPException(status_code=400, detail="请选择选项或输入自定义内容")

    # 保存用户消息
    user_msg = StoryMessage(
        session_id=session.id,
        role="user",
        content=user_choice,
        chosen_option=user_choice,
        branch_id=session.current_branch_id,
        parent_branch_id=session.current_branch_id,
    )
    db.add(user_msg)

    # 记录选择
    choices = session.choices_made or []
    choices.append(user_choice)
    session.choices_made = choices

    # 生成AI回复
    response = await generate_response(story, session, user_choice, db)

    # 创建新分支节点
    new_branch = StoryBranch(
        session_id=session.id,
        parent_id=session.current_branch_id,
        content=response["content"][:200],
        choice_text=user_choice[:100],
        depth=len(choices),
    )
    db.add(new_branch)
    db.commit()
    db.refresh(new_branch)

    # 保存旁白消息
    narrator_msg = StoryMessage(
        session_id=session.id,
        role="narrator",
        content=response["content"],
        options=response["options"],
        branch_id=new_branch.id,
        parent_branch_id=session.current_branch_id,
    )
    db.add(narrator_msg)

    session.current_branch_id = new_branch.id
    db.commit()

    return narrator_msg.to_dict()

# ========== AI生成逻辑 ==========

async def generate_opening(story: Story, session: StorySession) -> dict:
    """生成开场白"""
    protagonist_info = ""
    if session.protagonist_name:
        protagonist_info = f"\n主角名字：{session.protagonist_name}"
    if session.protagonist_desc:
        protagonist_info += f"\n主角设定：{session.protagonist_desc}"
    if story.protagonist:
        protagonist_info += f"\n默认主角设定：{story.protagonist}"

    system_prompt = story.system_prompt or "你是一个互动剧情的旁白者。"

    prompt = f"""生成开场白。

背景：{story.background}
任务：{story.task}
{protagonist_info}

【输出格式要求】
第一部分：场景描述（100-150字，直接写内容，不要加标题）
第二部分：换行后写"【选项】"
第三部分：列出5个选项，每行一个，格式为"1. 选项内容"

开始："""

    try:
        if llm_service:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
            response = llm_service.chat(messages, max_tokens=300, temperature=0.8)
            if response and len(response) > 10:
                return parse_response(response)
    except Exception as e:
        print(f"生成开场白失败: {e}")

    # 默认开场白
    return {
        "content": f"欢迎来到{story.title}。\n\n{story.background}\n\n你的任务是：{story.task}\n\n故事即将开始...",
        "options": [
            "开始探索周围的环境",
            "寻找可能的线索",
            "与附近的人交谈",
            "仔细观察细节",
            "制定行动计划"
        ]
    }

async def generate_response(story: Story, session: StorySession, choice: str, db: Session) -> dict:
    """生成剧情回复"""
    # 获取最近的对话历史
    recent_messages = db.query(StoryMessage).filter(
        StoryMessage.session_id == session.id
    ).order_by(StoryMessage.created_at.desc()).limit(10).all()

    history = ""
    for msg in reversed(recent_messages):
        if msg.role == "narrator":
            history += f"\n[旁白] {msg.content}"
        else:
            history += f"\n[玩家] {msg.content}"

    protagonist_info = ""
    if session.protagonist_name:
        protagonist_info = f"\n主角：{session.protagonist_name}"
    if session.protagonist_desc:
        protagonist_info += f"（{session.protagonist_desc}）"

    system_prompt = story.system_prompt or "你是一个互动剧情的旁白者。"

    prompt = f"""继续剧情。

背景：{story.background}
任务：{story.task}
{protagonist_info}

历史：{history[-500:]}

玩家选择：{choice}

【输出格式要求】
第一部分：剧情描述（100-150字，直接写内容，不要加标题）
第二部分：换行后写"【选项】"
第三部分：列出5个新选项，每行一个，格式为"1. 选项内容"

继续："""

    try:
        if llm_service:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ]
            response = llm_service.chat(messages, max_tokens=300, temperature=0.8)
            if response and len(response) > 10:
                return parse_response(response)
    except Exception as e:
        print(f"生成回复失败: {e}")

    return {
        "content": f"你选择了：{choice}\n\n剧情继续发展...",
        "options": [
            "继续前进",
            "保持警惕",
            "寻找帮助",
            "改变策略",
            "冒险尝试"
        ]
    }

def parse_response(text: str) -> dict:
    """解析AI回复，提取内容和选项"""
    if not text:
        return {
            "content": "剧情加载中...",
            "options": ["继续探索", "保持谨慎", "主动出击", "寻求帮助", "仔细观察"]
        }

    lines = text.strip().split('\n')
    content_lines = []
    options = []
    in_options = False

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # 检测选项开始标记
        if '【选项】' in line or '选项：' in line or '**选项**' in line:
            in_options = True
            continue

        # 跳过markdown标题标记
        if line.startswith('#') or line.startswith('**场景') or line.startswith('**剧情'):
            line = line.lstrip('#').strip()
            if line.startswith('**'):
                line = line.strip('*').strip()

        if in_options:
            # 解析选项（支持多种格式）
            if (line[0].isdigit() and ('.' in line[:3] or '、' in line[:3] or ')' in line[:3])) or \
               (line.startswith('- ') or line.startswith('* ')):
                option = line.lstrip('0123456789.、）)- * ').strip()
                if option:
                    options.append(option)
            elif len(options) < 5 and len(line) < 50:
                options.append(line)
        else:
            content_lines.append(line)

    content = '\n'.join(content_lines).strip()

    # 如果内容为空，使用默认
    if not content:
        content = "故事正在展开..."

    # 如果没有解析到选项，生成默认选项
    if len(options) < 5:
        default_options = [
            "继续探索",
            "保持谨慎",
            "主动出击",
            "寻求帮助",
            "仔细观察"
        ]
        while len(options) < 5:
            options.append(default_options[len(options)])

    return {
        "content": content,
        "options": options[:5]
    }
