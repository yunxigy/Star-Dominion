"""Client and request identity types for the standalone site-auth service."""

from __future__ import annotations

from dataclasses import dataclass

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
                response = await client.post(
                    "/internal/v1/session/verify",
                    headers=headers,
                )
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
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ConnectionError("invalid site-auth response") from exc
