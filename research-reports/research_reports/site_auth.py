"""Unified site-auth client and FastAPI authorization dependencies."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Request, status
import httpx

from shared.site_auth_contract import (
    FORWARDED_CSRF_HEADER,
    REQUEST_METHOD_HEADER,
    SERVICE_KEY_HEADER,
    build_forwarded_context,
)


@dataclass(frozen=True, slots=True)
class SiteIdentity:
    id: str
    email: str
    username: str
    role: str
    is_active: bool


class SiteAuthRejected(PermissionError):
    def __init__(self, status_code: int) -> None:
        super().__init__("site authentication rejected")
        self.status_code = status_code


class SiteAuthClient:
    def __init__(
        self,
        *,
        base_url: str,
        service_key: str,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 3.0,
    ) -> None:
        if len(service_key) < 32:
            raise ValueError("SITE_AUTH_INTERNAL_KEY must contain at least 32 characters")
        self._base_url = base_url.rstrip("/")
        self._service_key = service_key
        self._transport = transport
        self._timeout = timeout

    async def verify(
        self,
        *,
        session_token: str,
        csrf_cookie: str | None = None,
        method: str = "GET",
        origin: str | None = None,
        csrf_header: str | None = None,
    ) -> SiteIdentity:
        forwarded_headers, cookies = build_forwarded_context(
            origin=origin,
            csrf=csrf_cookie,
            session=session_token,
        )
        headers = {
            SERVICE_KEY_HEADER: self._service_key,
            REQUEST_METHOD_HEADER: method.upper(),
            **forwarded_headers,
        }
        if csrf_header:
            headers[FORWARDED_CSRF_HEADER] = csrf_header
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                transport=self._transport,
                timeout=self._timeout,
                cookies=cookies,
            ) as client:
                response = await client.post("/internal/v1/session/verify", headers=headers)
        except httpx.RequestError as exc:
            raise ConnectionError("site-auth unavailable") from exc
        if response.status_code in {401, 403}:
            raise SiteAuthRejected(response.status_code)
        if response.status_code != 200:
            raise ConnectionError("unexpected site-auth response")
        try:
            payload = response.json()
            return SiteIdentity(
                id=str(payload["id"]),
                email=str(payload["email"]),
                username=str(payload["username"]),
                role=str(payload["role"]),
                is_active=True,
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ConnectionError("invalid site-auth response") from exc


async def get_site_identity(request: Request) -> SiteIdentity:
    session_token = request.cookies.get("sd_session")
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="需要登录")
    try:
        identity = await request.app.state.site_auth_client.verify(
            session_token=session_token,
            csrf_cookie=request.cookies.get("sd_csrf"),
            method=request.method,
            origin=request.headers.get("origin"),
            csrf_header=request.headers.get("x-csrf-token"),
        )
    except SiteAuthRejected as exc:
        detail = "需要登录" if exc.status_code == 401 else "请求校验失败"
        raise HTTPException(status_code=exc.status_code, detail=detail) from exc
    except ConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="统一认证服务暂时不可用",
        ) from exc
    if not identity.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号已停用")
    return identity


async def require_admin(request: Request) -> SiteIdentity:
    identity = await get_site_identity(request)
    if identity.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return identity
