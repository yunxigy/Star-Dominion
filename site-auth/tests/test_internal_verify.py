from fastapi.testclient import TestClient


def test_internal_verify_requires_service_key(client: TestClient) -> None:
    missing = client.post("/internal/v1/session/verify")
    wrong = client.post(
        "/internal/v1/session/verify",
        headers={"X-Site-Service-Key": "wrong"},
    )

    assert missing.status_code == 401
    assert wrong.status_code == 401


def test_internal_verify_returns_authenticated_identity(login: TestClient) -> None:
    response = login.post(
        "/internal/v1/session/verify",
        headers={
            "X-Site-Service-Key": "internal-test-key-0123456789abcdef",
            "X-Site-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "id": response.json()["id"],
        "email": "admin@example.com",
        "username": "admin",
        "role": "admin",
    }


def test_internal_verify_checks_csrf_for_unsafe_requests(login: TestClient) -> None:
    headers = {
        "X-Site-Service-Key": "internal-test-key-0123456789abcdef",
        "X-Site-Request-Method": "POST",
        "X-Site-Request-Origin": "https://testserver",
    }
    missing = login.post("/internal/v1/session/verify", headers=headers)
    assert missing.status_code == 403

    headers["X-Site-CSRF"] = login.cookies.get("sd_csrf") or ""
    valid = login.post("/internal/v1/session/verify", headers=headers)
    assert valid.status_code == 200
