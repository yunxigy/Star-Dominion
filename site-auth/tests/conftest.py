from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from site_auth.config import Settings
from site_auth.main import create_app
from site_auth.models import User
from site_auth.passwords import hash_password


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path,
        internal_service_key="internal-test-key-0123456789abcdef",
        allowed_origins=("https://testserver",),
        cookie_secure=True,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings)
    with app.state.database.sessions() as database_session:
        database_session.add(
            User(
                email="admin@example.com",
                username="admin",
                password_hash=hash_password("correct horse battery staple"),
                role="admin",
            )
        )
        database_session.commit()

    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client


@pytest.fixture
def login(client: TestClient) -> TestClient:
    response = client.post(
        "/api/v1/session/login",
        headers={"Origin": "https://testserver"},
        json={
            "identity": "admin",
            "password": "correct horse battery staple",
        },
    )
    assert response.status_code == 204
    return client

