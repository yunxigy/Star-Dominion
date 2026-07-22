from pathlib import Path
import asyncio

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

from server.middleware.auth import get_current_user
from server.middleware.site_auth_client import SiteAuthClient, SiteUser


ROOT = Path(__file__).resolve().parents[1]


def test_missing_session_cookie_is_401_without_network_call() -> None:
    class NeverCalled:
        async def verify(self, **_):
            raise AssertionError("authentication service must not be called")

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/chat/sessions",
            "headers": [],
            "app": type("App", (), {"state": type("State", (), {"site_auth_client": NeverCalled()})()})(),
        }
    )

    with pytest.raises(HTTPException) as captured:
        asyncio.run(get_current_user(request))
    assert captured.value.status_code == 401


def test_site_auth_client_forwards_session_and_request_context() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/v1/session/verify"
        assert request.headers["x-site-service-key"] == "k" * 32
        assert request.headers["x-site-request-method"] == "POST"
        assert request.headers["x-site-request-origin"] == "https://testserver"
        assert request.headers["x-site-csrf"] == "csrf-value"
        assert "sd_session=session-value" in request.headers["cookie"]
        assert "sd_csrf=csrf-value" in request.headers["cookie"]
        return httpx.Response(
            200,
            json={
                "id": "site-user-id",
                "email": "owner@example.com",
                "username": "owner",
                "role": "admin",
            },
        )

    client = SiteAuthClient(
        base_url="http://127.0.0.1:8000",
        service_key="k" * 32,
        transport=httpx.MockTransport(handler),
    )

    identity = asyncio.run(
        client.verify(
            session_token="session-value",
            csrf_cookie="csrf-value",
            method="POST",
            origin="https://testserver",
            csrf_header="csrf-value",
        )
    )

    assert identity == SiteUser(
        id="site-user-id",
        email="owner@example.com",
        username="owner",
        role="admin",
    )
    assert identity.is_active is True


def test_site_auth_client_maps_auth_and_availability_errors() -> None:
    unauthorized = SiteAuthClient(
        base_url="http://127.0.0.1:8000",
        service_key="k" * 32,
        transport=httpx.MockTransport(lambda _: httpx.Response(401)),
    )
    unavailable = SiteAuthClient(
        base_url="http://127.0.0.1:8000",
        service_key="k" * 32,
        transport=httpx.MockTransport(
            lambda _: (_ for _ in ()).throw(httpx.ConnectError("offline"))
        ),
    )

    with pytest.raises(PermissionError):
        asyncio.run(unauthorized.verify(session_token="bad"))
    with pytest.raises(ConnectionError):
        asyncio.run(unavailable.verify(session_token="session"))


def test_site_auth_client_proxies_admin_requests_with_cookie_and_csrf() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/admin/users/user-1"
        assert request.method == "PATCH"
        assert request.headers["x-csrf-token"] == "csrf-value"
        assert request.headers["origin"] == "https://testserver"
        assert "sd_session=session-value" in request.headers["cookie"]
        return httpx.Response(
            200,
            json={
                "id": "user-1",
                "email": "reader@example.com",
                "username": "reader",
                "role": "user",
                "is_active": False,
            },
        )

    client = SiteAuthClient(
        base_url="http://127.0.0.1:8000",
        service_key="k" * 32,
        transport=httpx.MockTransport(handler),
    )
    response = asyncio.run(
        client.admin_request(
            path="/api/v1/admin/users/user-1",
            method="PATCH",
            session_token="session-value",
            csrf_cookie="csrf-value",
            csrf_header="csrf-value",
            origin="https://testserver",
            payload={"is_active": False},
        )
    )

    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_legacy_credentials_and_hashing_are_removed() -> None:
    middleware = (ROOT / "server" / "middleware" / "auth.py").read_text("utf-8")
    server_source = "\n".join(
        path.read_text("utf-8") for path in (ROOT / "server").rglob("*.py")
    )
    main = (ROOT / "server" / "main.py").read_text("utf-8")
    admin_script = (ROOT / "create_admin.py").read_text("utf-8")

    assert "JWT_SECRET" not in middleware
    assert "hashlib.sha256" not in middleware
    assert "shouanren2024" not in middleware
    assert "get_password_hash" not in server_source
    assert "admin123" not in main
    assert "admin123" not in admin_script


def test_legacy_login_pages_redirect_without_local_storage_tokens() -> None:
    for name in ("login.html", "register.html"):
        content = (ROOT / "frontend" / name).read_text("utf-8")
        assert "localStorage" not in content
        assert "/auth/login?next=%2Fwuwa%2F" in content


def test_frontend_no_longer_reads_browser_auth_tokens() -> None:
    offenders = []
    for path in (ROOT / "frontend").rglob("*"):
        if path.suffix not in {".html", ".js"}:
            continue
        content = path.read_text("utf-8")
        if (
            "localStorage.getItem('token')" in content
            or "localStorage.getItem('user')" in content
        ):
            offenders.append(path.relative_to(ROOT).as_posix())
    assert offenders == []


def test_frontend_strips_legacy_bearer_headers() -> None:
    frontend_source = "\n".join(
        path.read_text("utf-8")
        for path in (ROOT / "frontend").rglob("*")
        if path.suffix in {".html", ".js"}
    )
    auth_adapter = (ROOT / "frontend" / "js" / "auth.js").read_text("utf-8")

    assert "site-cookie-session" not in frontend_source
    assert "headers.delete('Authorization')" in auth_adapter


def test_default_backend_port_is_8006() -> None:
    config = (ROOT / "server" / "config.py").read_text("utf-8")
    assert '"port": 8006' in config
