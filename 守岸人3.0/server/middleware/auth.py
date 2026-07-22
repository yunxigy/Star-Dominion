"""Compatibility dependencies backed by the standalone site-auth service."""

from __future__ import annotations

from fastapi import HTTPException, Request, status

from .site_auth_client import SiteAuthClient, SiteAuthRejected, SiteUser


async def get_current_user(request: Request) -> SiteUser:
    session_token = request.cookies.get("sd_session")
    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="需要登录",
        )
    client = getattr(request.app.state, "site_auth_client", None)
    if client is None:
        try:
            client = SiteAuthClient.from_env()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="统一认证服务尚未配置",
            ) from exc
        request.app.state.site_auth_client = client

    try:
        return await client.verify(
            session_token=session_token,
            csrf_cookie=request.cookies.get("sd_csrf"),
            method=request.method,
            origin=request.headers.get("origin"),
            csrf_header=request.headers.get("x-csrf-token"),
        )
    except SiteAuthRejected as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail="需要登录" if exc.status_code == 401 else "请求校验失败",
        ) from exc
    except ConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="统一认证服务暂时不可用",
        ) from exc


async def get_current_admin(request: Request) -> SiteUser:
    user = await get_current_user(request)
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return user
