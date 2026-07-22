"""Client for the standalone site-auth introspection endpoint."""

from __future__ import annotations

from dataclasses import dataclass
import os

import httpx


@dataclass(frozen=True, slots=True)
class SiteUser:
    id: str
    email: str
    username: str
    role: str
    is_active: bool = True

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "email": self.email,
            "username": self.username,
            "role": self.role,
            "is_active": self.is_active,
        }


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
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key
        self.transport = transport
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "SiteAuthClient":
        service_key = os.getenv("SITE_AUTH_INTERNAL_KEY", "")
        return cls(
            base_url=os.getenv("SITE_AUTH_URL", "http://127.0.0.1:8000"),
            service_key=service_key,
        )

    async def verify(
        self,
        *,
        session_token: str | None,
        csrf_cookie: str | None = None,
        method: str = "GET",
        origin: str | None = None,
        csrf_header: str | None = None,
    ) -> SiteUser:
        headers = {
            "X-Site-Service-Key": self.service_key,
            "X-Site-Request-Method": method.upper(),
        }
        if origin:
            headers["X-Site-Request-Origin"] = origin
        if csrf_header:
            headers["X-Site-CSRF"] = csrf_header
        cookies: dict[str, str] = {}
        if session_token:
            cookies["sd_session"] = session_token
        if csrf_cookie:
            cookies["sd_csrf"] = csrf_cookie

        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                transport=self.transport,
                timeout=self.timeout,
                cookies=cookies,
            ) as client:
                response = await client.post(
                    "/internal/v1/session/verify",
                    headers=headers,
                )
        except httpx.RequestError as exc:
            raise ConnectionError("site-auth unavailable") from exc

        if response.status_code in {401, 403}:
            raise SiteAuthRejected(response.status_code)
        if response.status_code >= 500:
            raise ConnectionError("site-auth unavailable")
        if response.status_code != 200:
            raise ConnectionError("unexpected site-auth response")
        try:
            payload = response.json()
            return SiteUser(
                id=payload["id"],
                email=payload["email"],
                username=payload["username"],
                role=payload["role"],
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ConnectionError("invalid site-auth response") from exc

    async def admin_request(
        self,
        *,
        path: str,
        method: str,
        session_token: str | None,
        csrf_cookie: str | None = None,
        csrf_header: str | None = None,
        origin: str | None = None,
        payload: dict[str, object] | None = None,
    ) -> httpx.Response:
        if not path.startswith("/api/v1/admin/") and path != "/api/v1/admin/users":
            raise ValueError("admin proxy path is outside the allowed prefix")
        headers: dict[str, str] = {}
        if csrf_header:
            headers["X-CSRF-Token"] = csrf_header
        if origin:
            headers["Origin"] = origin
        cookies: dict[str, str] = {}
        if session_token:
            cookies["sd_session"] = session_token
        if csrf_cookie:
            cookies["sd_csrf"] = csrf_cookie
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                transport=self.transport,
                timeout=self.timeout,
                cookies=cookies,
            ) as client:
                return await client.request(
                    method.upper(),
                    path,
                    headers=headers,
                    json=payload,
                )
        except httpx.RequestError as exc:
            raise ConnectionError("site-auth unavailable") from exc
