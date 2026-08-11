import asyncio

import httpx

from research_reports.site_auth import SiteAuthClient


def test_site_auth_forwards_cookie_and_request_context() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/v1/session/verify"
        assert request.headers["X-Site-Service-Key"] == "k" * 32
        assert request.headers["X-Site-Request-Method"] == "POST"
        assert request.headers["X-Site-Request-Origin"] == "http://127.0.0.1:5173"
        assert request.headers["X-Site-CSRF"] == "csrf-value"
        assert "sd_session=session-value" in request.headers["Cookie"]
        return httpx.Response(
            200,
            json={
                "id": "site-user-1",
                "email": "admin@local.invalid",
                "username": "admin",
                "role": "admin",
            },
        )

    client = SiteAuthClient(
        base_url="http://site-auth.test",
        service_key="k" * 32,
        transport=httpx.MockTransport(handler),
    )
    identity = asyncio.run(
        client.verify(
            session_token="session-value",
            csrf_cookie="csrf-value",
            method="POST",
            origin="http://127.0.0.1:5173",
            csrf_header="csrf-value",
        )
    )

    assert identity.username == "admin"
    assert identity.role == "admin"
    assert identity.is_active is True
