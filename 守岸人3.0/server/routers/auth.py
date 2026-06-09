# -*- coding: utf-8 -*-
"""认证路由"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models.user import User
from ..middleware.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    is_sha256_hash,
)
from ..models.user import RefreshToken
from datetime import datetime, timedelta
import hashlib

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: str
    username: str
    password: str


class LoginRequest(BaseModel):
    email: str  # 可以是邮箱或用户名
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


def _issue_tokens(user: User, db: Session) -> dict:
    """生成 access token 和 refresh token"""
    access_token = create_access_token(data={"sub": user.id})
    refresh_token = create_refresh_token(data={"sub": user.id})
    token_hash = hashlib.sha256(refresh_token.encode()).hexdigest()
    expires_at = datetime.utcnow() + timedelta(days=7)

    db.add(RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
    ))
    db.commit()

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user.to_dict(),
    }


@router.post("/register")
async def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """用户注册"""
    # 密码强度校验
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="密码至少需要 8 位")

    # 检查邮箱是否已存在
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="邮箱已被注册")

    # 检查用户名是否已存在
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="用户名已被占用")

    # 创建用户
    user = User(
        email=req.email,
        username=req.username,
        password_hash=get_password_hash(req.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return _issue_tokens(user, db)


@router.post("/login")
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    """用户登录（支持邮箱或用户名）"""
    # 先尝试邮箱登录，再尝试用户名登录
    user = db.query(User).filter(User.email == req.email).first()
    if not user:
        user = db.query(User).filter(User.username == req.email).first()

    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱/用户名或密码错误")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="账号已被禁用")

    # 密码迁移：如果是旧版 SHA256 哈希，自动升级为 bcrypt
    if is_sha256_hash(user.password_hash):
        user.password_hash = get_password_hash(req.password)
        db.commit()

    return _issue_tokens(user, db)


@router.post("/refresh")
async def refresh(req: RefreshRequest, db: Session = Depends(get_db)):
    """刷新 access token"""
    try:
        payload = decode_token(req.refresh_token)
    except HTTPException:
        raise HTTPException(status_code=401, detail="刷新令牌无效")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="刷新令牌类型错误")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="刷新令牌无效")

    token_hash = hashlib.sha256(req.refresh_token.encode()).hexdigest()
    stored = db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked == False,
    ).first()

    if not stored or stored.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="刷新令牌已过期或已撤销")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="用户不存在或已被禁用")

    stored.revoked = True
    db.commit()
    return _issue_tokens(user, db)


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    """获取当前用户信息"""
    return current_user.to_dict()


@router.put("/me")
async def update_me(
    username: str = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新用户信息"""
    if username:
        existing = db.query(User).filter(
            User.username == username,
            User.id != current_user.id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="用户名已被占用")
        current_user.username = username

    db.commit()
    db.refresh(current_user)
    return current_user.to_dict()
