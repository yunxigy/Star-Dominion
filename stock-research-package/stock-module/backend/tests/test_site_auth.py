import asyncio

import httpx
import pytest

from app.main import create_app
from app.security.site_auth import SiteAuthClient, SiteAuthRejected, SiteIdentity


class FakeSiteAuthClient:
    async def verify(self, *, session_token: str, **_: object) -> SiteIdentity:
        if session_token == "admin-session":
            return SiteIdentity("admin-id", "admin@example.com", "admin", "admin")
        if session_token == "user-session":
            return SiteIdentity("user-id", "user@example.com", "user", "user")
        raise SiteAuthRejected(401)


class EmptyProfiles:
    def for_owner(self, _: str) -> "EmptyProfiles":
        return self

    def list_available(self) -> list[object]:
        return []


class EmptyAnalyses:
    def shutdown(self) -> None:
        return None


def test_site_auth_forwards_cookie_and_csrf_context() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/v1/session/verify"
        assert request.headers["X-Site-Service-Key"] == "k" * 32
        assert request.headers["X-Site-Request-Method"] == "POST"
        assert request.headers["X-Site-Request-Origin"] == "https://zhumenggy.top"
        assert request.headers["X-Site-CSRF"] == "csrf-value"
        assert "sd_session=session-value" in request.headers["Cookie"]
        assert "sd_csrf=csrf-value" in request.headers["Cookie"]
        return httpx.Response(
            200,
            json={
                "id": "user-a",
                "email": "a@example.com",
                "username": "user-a",
                "role": "user",
            },
        )

    client = SiteAuthClient(
        base_url="http://site-auth",
        service_key="k" * 32,
        transport=httpx.MockTransport(handler),
    )

    identity = asyncio.run(
        client.verify(
            session_token="session-value",
            csrf_cookie="csrf-value",
            method="POST",
            origin="https://zhumenggy.top",
            csrf_header="csrf-value",
        )
    )

    assert identity.id == "user-a"
    assert identity.role == "user"


def test_site_auth_rejects_invalid_session_without_leaking_response() -> None:
    client = SiteAuthClient(
        base_url="http://site-auth",
        service_key="k" * 32,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(401, json={"detail": "secret internal reason"})
        ),
    )

    with pytest.raises(SiteAuthRejected) as error:
        asyncio.run(client.verify(session_token="invalid"))

    assert error.value.status_code == 401
    assert "secret internal reason" not in str(error.value)


def test_public_browsing_and_protected_stock_actions() -> None:
    application = create_app(
        model_profile_service=EmptyProfiles(),  # type: ignore[arg-type]
        analysis_coordinator=EmptyAnalyses(),  # type: ignore[arg-type]
        site_auth_client=FakeSiteAuthClient(),  # type: ignore[arg-type]
    )

    async def exercise() -> tuple[httpx.Response, httpx.Response, httpx.Response]:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application), base_url="http://test"
        ) as client:
            public = await client.get("/api/v1/candidates")
            anonymous = await client.get("/api/v1/model-profiles")
            authenticated = await client.get(
                "/api/v1/model-profiles",
                cookies={"sd_session": "user-session"},
            )
        return public, anonymous, authenticated

    public, anonymous, authenticated = asyncio.run(exercise())

    assert public.status_code == 200
    assert anonymous.status_code == 401
    assert authenticated.status_code == 200


def test_refresh_requires_admin_role() -> None:
    application = create_app(
        model_profile_service=EmptyProfiles(),  # type: ignore[arg-type]
        analysis_coordinator=EmptyAnalyses(),  # type: ignore[arg-type]
        site_auth_client=FakeSiteAuthClient(),  # type: ignore[arg-type]
    )

    async def exercise() -> tuple[httpx.Response, httpx.Response]:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application), base_url="http://test"
        ) as client:
            user = await client.post(
                "/api/v1/candidates/refresh",
                cookies={"sd_session": "user-session"},
            )
            admin = await client.post(
                "/api/v1/candidates/refresh",
                cookies={"sd_session": "admin-session"},
            )
        return user, admin

    user, admin = asyncio.run(exercise())

    assert user.status_code == 403
    assert admin.status_code == 202
