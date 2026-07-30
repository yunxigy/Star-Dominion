"""Administrator-only user lifecycle endpoints."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session as OrmSession

from .dependencies import authenticate_request
from .models import Session as AuthSession
from .models import User
from .passwords import hash_password
from .session_service import AuthenticatedSession, CSRF_COOKIE


router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class AdminUserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    username: str
    role: str
    is_active: bool


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    username: str = Field(min_length=2, max_length=50)
    password: SecretStr = Field(min_length=12, max_length=1024)
    role: Literal["user", "admin"] = "user"

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized:
            raise ValueError("email must contain @")
        return normalized


class UserUpdate(BaseModel):
    role: Literal["user", "admin"] | None = None
    is_active: bool | None = None


class PasswordReset(BaseModel):
    password: SecretStr = Field(min_length=12, max_length=1024)


@dataclass(slots=True)
class AdminContext:
    db: OrmSession
    authenticated: AuthenticatedSession


def _admin_context(request: Request) -> Iterator[AdminContext]:
    with request.app.state.database.sessions() as db:
        authenticated = authenticate_request(request, db)
        if authenticated.user.role != "admin":
            raise HTTPException(status_code=403, detail="需要管理员权限")
        valid = request.app.state.session_service.validate_request(
            authenticated,
            method=request.method,
            origin=request.headers.get("origin"),
            csrf_cookie=request.cookies.get(CSRF_COOKIE),
            csrf_header=request.headers.get("x-csrf-token"),
            allowed_origins=request.app.state.settings.allowed_origins,
        )
        if not valid:
            raise HTTPException(status_code=403, detail="CSRF 校验失败")
        yield AdminContext(db=db, authenticated=authenticated)


def _find_user(db: OrmSession, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return user


def _revoke_user_sessions(db: OrmSession, user_id: str) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


@router.get("/users")
def list_users(context: AdminContext = Depends(_admin_context)) -> dict[str, list[AdminUserPublic]]:
    users = context.db.scalars(select(User).order_by(User.created_at)).all()
    return {"items": [AdminUserPublic.model_validate(user) for user in users]}


@router.post(
    "/users",
    response_model=AdminUserPublic,
    status_code=status.HTTP_201_CREATED,
)
def create_user(
    payload: UserCreate,
    context: AdminContext = Depends(_admin_context),
) -> AdminUserPublic:
    username = payload.username.strip()
    duplicate = context.db.scalar(
        select(User).where(
            or_(
                func.lower(User.email) == payload.email,
                func.lower(User.username) == username.lower(),
            )
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="邮箱或用户名已存在")
    user = User(
        email=payload.email,
        username=username,
        password_hash=hash_password(payload.password.get_secret_value()),
        role=payload.role,
    )
    context.db.add(user)
    context.db.commit()
    context.db.refresh(user)
    return AdminUserPublic.model_validate(user)


@router.patch("/users/{user_id}", response_model=AdminUserPublic)
def update_user(
    user_id: str,
    payload: UserUpdate,
    context: AdminContext = Depends(_admin_context),
) -> AdminUserPublic:
    user = _find_user(context.db, user_id)
    is_self = user.id == context.authenticated.user.id
    if is_self and payload.is_active is False:
        raise HTTPException(status_code=400, detail="不能禁用当前管理员")
    if is_self and payload.role == "user":
        raise HTTPException(status_code=400, detail="不能移除当前管理员权限")
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
        if not user.is_active:
            _revoke_user_sessions(context.db, user.id)
    context.db.commit()
    context.db.refresh(user)
    return AdminUserPublic.model_validate(user)


@router.post(
    "/users/{user_id}/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
)
def reset_password(
    user_id: str,
    payload: PasswordReset,
    context: AdminContext = Depends(_admin_context),
) -> Response:
    user = _find_user(context.db, user_id)
    user.password_hash = hash_password(payload.password.get_secret_value())
    _revoke_user_sessions(context.db, user.id)
    context.db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
