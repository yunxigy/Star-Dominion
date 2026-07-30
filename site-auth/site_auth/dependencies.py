"""FastAPI dependencies for authenticated browser sessions."""

from collections.abc import Iterator

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session as OrmSession

from .models import User
from .session_service import AuthenticatedSession, SESSION_COOKIE


def get_db(request: Request) -> Iterator[OrmSession]:
    with request.app.state.database.sessions() as db:
        yield db


def authenticate_request(request: Request, db: OrmSession) -> AuthenticatedSession:
    authenticated = request.app.state.session_service.authenticate(
        db,
        request.cookies.get(SESSION_COOKIE),
    )
    if authenticated is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="需要登录",
        )
    return authenticated


def require_admin(user: User) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return user
