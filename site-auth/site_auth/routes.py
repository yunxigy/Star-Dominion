"""Browser-facing session routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as OrmSession

from .dependencies import authenticate_request, get_db
from .models import User
from .passwords import hash_password, password_needs_rehash, verify_password
from .schemas import LoginRequest, UserPublic
from .session_service import CSRF_COOKIE, SESSION_COOKIE, SESSION_TTL


router = APIRouter(prefix="/api/v1/session", tags=["session"])
_DUMMY_PASSWORD_HASH = hash_password("not-a-real-account-password")


def _trusted_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    return bool(
        origin
        and origin.rstrip("/") in request.app.state.settings.allowed_origins
    )


def _set_session_cookies(
    response: Response,
    *,
    token: str,
    csrf_token: str,
    secure: bool,
) -> None:
    max_age = int(SESSION_TTL.total_seconds())
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
def login(
    payload: LoginRequest,
    request: Request,
    db: OrmSession = Depends(get_db),
) -> Response:
    if not _trusted_origin(request):
        raise HTTPException(status_code=403, detail="请求来源不受信任")

    identity = payload.identity.strip().lower()
    client_ip = request.client.host if request.client is not None else "unknown"
    limiter = request.app.state.login_rate_limiter
    if not limiter.can_attempt(client_ip, identity):
        raise HTTPException(status_code=429, detail="登录尝试过多，请稍后再试")
    user = db.scalar(
        select(User).where(
            or_(
                func.lower(User.email) == identity,
                func.lower(User.username) == identity,
            )
        )
    )
    password = payload.password.get_secret_value()
    valid_password = (
        verify_password(password, user.password_hash)
        if user is not None
        else verify_password(password, _DUMMY_PASSWORD_HASH)
    )
    if user is None or not valid_password or not user.is_active:
        if not limiter.record_failure(client_ip, identity):
            raise HTTPException(status_code=429, detail="登录尝试过多，请稍后再试")
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    limiter.record_success(client_ip, identity)

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
        db.commit()

    created = request.app.state.session_service.create(db, user)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _set_session_cookies(
        response,
        token=created.token,
        csrf_token=created.csrf_token,
        secure=request.app.state.settings.cookie_secure,
    )
    return response


@router.get("/me", response_model=UserPublic)
def me(
    request: Request,
    db: OrmSession = Depends(get_db),
) -> UserPublic:
    authenticated = authenticate_request(request, db)
    return UserPublic.model_validate(authenticated.user)


@router.get("/csrf")
def csrf(
    request: Request,
    db: OrmSession = Depends(get_db),
) -> dict[str, str]:
    authenticate_request(request, db)
    token = request.cookies.get(CSRF_COOKIE)
    if not token:
        raise HTTPException(status_code=403, detail="CSRF 凭据缺失")
    return {"csrf_token": token}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    db: OrmSession = Depends(get_db),
) -> Response:
    authenticated = authenticate_request(request, db)
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
    request.app.state.session_service.revoke(db, authenticated)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return response
