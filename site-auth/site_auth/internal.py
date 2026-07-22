"""Localhost service-to-service session introspection."""

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session as OrmSession

from .dependencies import get_db
from .schemas import UserPublic
from .session_service import CSRF_COOKIE, SESSION_COOKIE


router = APIRouter(prefix="/internal/v1", tags=["internal"])


@router.post("/session/verify", response_model=UserPublic)
def verify_session(
    request: Request,
    db: OrmSession = Depends(get_db),
    service_key: str | None = Header(default=None, alias="X-Site-Service-Key"),
    forwarded_method: str = Header(default="GET", alias="X-Site-Request-Method"),
    forwarded_origin: str | None = Header(default=None, alias="X-Site-Request-Origin"),
    forwarded_csrf: str | None = Header(default=None, alias="X-Site-CSRF"),
) -> UserPublic:
    expected = request.app.state.settings.internal_service_key
    if service_key is None or not hmac.compare_digest(service_key, expected):
        raise HTTPException(status_code=401, detail="内部服务认证失败")

    authenticated = request.app.state.session_service.authenticate(
        db,
        request.cookies.get(SESSION_COOKIE),
    )
    if authenticated is None:
        raise HTTPException(status_code=401, detail="需要登录")

    valid = request.app.state.session_service.validate_request(
        authenticated,
        method=forwarded_method,
        origin=forwarded_origin,
        csrf_cookie=request.cookies.get(CSRF_COOKIE),
        csrf_header=forwarded_csrf,
        allowed_origins=request.app.state.settings.allowed_origins,
    )
    if not valid:
        raise HTTPException(status_code=403, detail="CSRF 校验失败")
    return UserPublic.model_validate(authenticated.user)

