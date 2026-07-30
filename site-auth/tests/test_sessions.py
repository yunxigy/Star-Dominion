from fastapi.testclient import TestClient


def test_login_sets_secure_cookies_and_me_returns_user(client: TestClient) -> None:
    response = client.post(
        "/api/v1/session/login",
        headers={"Origin": "https://testserver"},
        json={
            "identity": "admin@example.com",
            "password": "correct horse battery staple",
        },
    )

    assert response.status_code == 204
    cookies = response.headers.get_list("set-cookie")
    session_cookie = next(item for item in cookies if item.startswith("sd_session="))
    csrf_cookie = next(item for item in cookies if item.startswith("sd_csrf="))
    assert "HttpOnly" in session_cookie
    assert "Secure" in session_cookie
    assert "SameSite=lax" in session_cookie
    assert "HttpOnly" not in csrf_cookie
    assert "Secure" in csrf_cookie

    me = client.get("/api/v1/session/me")
    assert me.status_code == 200
    assert me.json() == {
        "id": me.json()["id"],
        "email": "admin@example.com",
        "username": "admin",
        "role": "admin",
    }


def test_unknown_user_and_bad_password_have_same_error(client: TestClient) -> None:
    unknown = client.post(
        "/api/v1/session/login",
        headers={"Origin": "https://testserver"},
        json={"identity": "missing", "password": "anything"},
    )
    wrong = client.post(
        "/api/v1/session/login",
        headers={"Origin": "https://testserver"},
        json={"identity": "admin", "password": "wrong"},
    )

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json() == {"detail": "用户名或密码错误"}


def test_login_rejects_untrusted_origin(client: TestClient) -> None:
    response = client.post(
        "/api/v1/session/login",
        headers={"Origin": "https://evil.example"},
        json={
            "identity": "admin",
            "password": "correct horse battery staple",
        },
    )

    assert response.status_code == 403


def test_logout_requires_csrf_and_revokes_session(login: TestClient) -> None:
    missing = login.post(
        "/api/v1/session/logout",
        headers={"Origin": "https://testserver"},
    )
    assert missing.status_code == 403

    csrf = login.cookies.get("sd_csrf")
    response = login.post(
        "/api/v1/session/logout",
        headers={
            "Origin": "https://testserver",
            "X-CSRF-Token": csrf or "",
        },
    )

    assert response.status_code == 204
    assert login.get("/api/v1/session/me").status_code == 401


def test_public_registration_route_does_not_exist(client: TestClient) -> None:
    response = client.post(
        "/api/v1/register",
        json={
            "email": "new@example.com",
            "username": "new-user",
            "password": "a sufficiently long password",
        },
    )

    assert response.status_code == 404
