from fastapi.testclient import TestClient


def _csrf_headers(client: TestClient) -> dict[str, str]:
    return {
        "Origin": "https://testserver",
        "X-CSRF-Token": client.cookies.get("sd_csrf") or "",
    }


def _create_user(login: TestClient, username: str = "reader") -> dict:
    response = login.post(
        "/api/v1/admin/users",
        headers=_csrf_headers(login),
        json={
            "email": f"{username}@example.com",
            "username": username,
            "password": "a long reader password",
            "role": "user",
        },
    )
    assert response.status_code == 201
    assert "password_hash" not in response.json()
    return response.json()


def test_admin_can_create_list_and_disable_user(login: TestClient) -> None:
    user = _create_user(login)

    listed = login.get("/api/v1/admin/users")
    assert listed.status_code == 200
    assert {item["username"] for item in listed.json()["items"]} == {
        "admin",
        "reader",
    }

    disabled = login.patch(
        f"/api/v1/admin/users/{user['id']}",
        headers=_csrf_headers(login),
        json={"is_active": False},
    )
    assert disabled.status_code == 200
    assert disabled.json()["is_active"] is False


def test_normal_user_cannot_access_admin_api(login: TestClient) -> None:
    _create_user(login)
    login.cookies.clear()
    signed_in = login.post(
        "/api/v1/session/login",
        headers={"Origin": "https://testserver"},
        json={"identity": "reader", "password": "a long reader password"},
    )
    assert signed_in.status_code == 204

    assert login.get("/api/v1/admin/users").status_code == 403


def test_password_reset_revokes_existing_sessions(login: TestClient) -> None:
    user = _create_user(login, "resetme")
    app = login.app
    with TestClient(app, base_url="https://testserver") as user_client:
        signed_in = user_client.post(
            "/api/v1/session/login",
            headers={"Origin": "https://testserver"},
            json={"identity": "resetme", "password": "a long reader password"},
        )
        assert signed_in.status_code == 204
        assert user_client.get("/api/v1/session/me").status_code == 200

        reset = login.post(
            f"/api/v1/admin/users/{user['id']}/reset-password",
            headers=_csrf_headers(login),
            json={"password": "a replacement password"},
        )
        assert reset.status_code == 204
        assert user_client.get("/api/v1/session/me").status_code == 401

        new_login = user_client.post(
            "/api/v1/session/login",
            headers={"Origin": "https://testserver"},
            json={"identity": "resetme", "password": "a replacement password"},
        )
        assert new_login.status_code == 204
