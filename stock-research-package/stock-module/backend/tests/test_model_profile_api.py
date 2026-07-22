import json
from pathlib import Path

from cryptography.fernet import Fernet
import httpx
import pytest

from app.config import Settings
from app.domain.model_profiles import ModelProfileCreate, PlatformModelProfileConfig
from app.integrations.model_providers import OpenAICompatibleProviderClient
from app.main import create_app
from app.repositories.model_profiles import ModelProfileRepository
from app.security.secrets import FernetSecretStore
from app.security.site_auth import SiteIdentity
from app.services.model_profiles import ModelProfileService
from tests.auth_helpers import AUTH_COOKIES, AuthenticatedSiteAuthClient


class PerSessionAuthClient:
    async def verify(self, *, session_token: str, **_: object) -> SiteIdentity:
        return SiteIdentity(
            id=session_token,
            email=f"{session_token}@example.com",
            username=session_token,
            role="user",
        )


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path,
        catalyst_report_path=tmp_path / "cat.json",
        user_strategy_snapshot_path=tmp_path / "strategy.json",
    )


def _profile_service(
    tmp_path: Path,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    platform_profiles: tuple[PlatformModelProfileConfig, ...] = (),
    environment: dict[str, str] | None = None,
) -> ModelProfileService:
    repository = ModelProfileRepository(tmp_path / "hub.db")
    secrets = FernetSecretStore(repository, Fernet.generate_key().decode("ascii"))
    provider = OpenAICompatibleProviderClient(
        transport=transport,
        resolver=lambda _: ["93.184.216.34"],
        production=True,
    )
    return ModelProfileService(
        repository,
        secrets,
        owner_id="local",
        provider_client=provider,
        platform_profiles=platform_profiles,
        environment=environment or {},
    )


@pytest.mark.asyncio
async def test_personal_profile_crud_never_returns_api_key(tmp_path: Path) -> None:
    service = _profile_service(tmp_path)
    application = create_app(settings=_settings(tmp_path), model_profile_service=service, site_auth_client=AuthenticatedSiteAuthClient())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test", cookies=AUTH_COOKIES
    ) as client:
        created = await client.post(
            "/api/v1/model-profiles",
            json={
                "name": "硅基流动",
                "provider": "siliconflow",
                "base_url": "https://api.siliconflow.cn/v1",
                "api_key": "secret-value",
                "timeout_seconds": 120,
            },
        )
        profile_id = created.json()["id"]
        listed = await client.get("/api/v1/model-profiles")
        updated = await client.patch(
            f"/api/v1/model-profiles/{profile_id}", json={"name": "新名称"}
        )
        deleted = await client.delete(f"/api/v1/model-profiles/{profile_id}")

    assert created.status_code == 201
    assert listed.status_code == 200
    assert listed.json()["items"][0]["id"] == profile_id
    assert updated.json()["name"] == "新名称"
    combined = json.dumps([created.json(), listed.json(), updated.json()], ensure_ascii=False)
    assert "secret-value" not in combined
    assert "api_key" not in combined
    assert deleted.status_code == 204


@pytest.mark.asyncio
async def test_profile_models_and_connection_test_use_safe_results(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer secret-value"
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "model-a"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    service = _profile_service(tmp_path, transport=httpx.MockTransport(handler))
    profile = service.create(
        ModelProfileCreate.siliconflow(name="硅基流动", api_key="secret-value")
    )
    application = create_app(settings=_settings(tmp_path), model_profile_service=service, site_auth_client=AuthenticatedSiteAuthClient())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test", cookies=AUTH_COOKIES
    ) as client:
        refreshed = await client.post(f"/api/v1/model-profiles/{profile.id}/models/refresh")
        cached = await client.get(f"/api/v1/model-profiles/{profile.id}/models")
        tested = await client.post(
            f"/api/v1/model-profiles/{profile.id}/test", json={"model": "model-a"}
        )

    assert refreshed.json() == {"items": ["model-a"]}
    assert cached.json() == {"items": ["model-a"]}
    assert tested.status_code == 200
    assert tested.json()["ok"] is True
    assert "secret-value" not in tested.text


@pytest.mark.asyncio
async def test_platform_profile_is_read_only(tmp_path: Path) -> None:
    platform = PlatformModelProfileConfig(
        id="platform-sf",
        name="平台硅基流动",
        provider="siliconflow",
        base_url="https://api.siliconflow.cn/v1",
        api_key_env="STOCK_PLATFORM_TEST_KEY",
    )
    service = _profile_service(
        tmp_path,
        platform_profiles=(platform,),
        environment={"STOCK_PLATFORM_TEST_KEY": "platform-secret"},
    )
    application = create_app(settings=_settings(tmp_path), model_profile_service=service, site_auth_client=AuthenticatedSiteAuthClient())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test", cookies=AUTH_COOKIES
    ) as client:
        listed = await client.get("/api/v1/model-profiles")
        updated = await client.patch("/api/v1/model-profiles/platform-sf", json={"name": "不能改"})
        deleted = await client.delete("/api/v1/model-profiles/platform-sf")

    item = listed.json()["items"][0]
    assert item["scope"] == "platform"
    assert item["key_configured"] is True
    assert updated.status_code == 404
    assert deleted.status_code == 404


@pytest.mark.asyncio
async def test_provider_error_returns_stable_code_without_raw_body(tmp_path: Path) -> None:
    service = _profile_service(
        tmp_path,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(401, json={"error": "provider-secret-debug-body"})
        ),
    )
    profile = service.create(
        ModelProfileCreate.siliconflow(name="SF", api_key="bad-key")
    )
    application = create_app(settings=_settings(tmp_path), model_profile_service=service, site_auth_client=AuthenticatedSiteAuthClient())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test", cookies=AUTH_COOKIES
    ) as client:
        response = await client.post(f"/api/v1/model-profiles/{profile.id}/models/refresh")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "MODEL_AUTH_FAILED"
    assert "provider-secret-debug-body" not in response.text


@pytest.mark.asyncio
async def test_personal_profiles_are_isolated_by_authenticated_user(tmp_path: Path) -> None:
    service = _profile_service(tmp_path)
    application = create_app(
        settings=_settings(tmp_path),
        model_profile_service=service,
        site_auth_client=PerSessionAuthClient(),  # type: ignore[arg-type]
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test"
    ) as client:
        created = await client.post(
            "/api/v1/model-profiles",
            cookies={"sd_session": "user-a"},
            json={
                "name": "A 的硅基流动",
                "provider": "siliconflow",
                "base_url": "https://api.siliconflow.cn/v1",
                "api_key": "user-a-secret",
            },
        )
        profile_id = created.json()["id"]
        user_b_list = await client.get(
            "/api/v1/model-profiles",
            cookies={"sd_session": "user-b"},
        )
        user_b_update = await client.patch(
            f"/api/v1/model-profiles/{profile_id}",
            cookies={"sd_session": "user-b"},
            json={"name": "越权修改"},
        )

    assert created.status_code == 201
    assert user_b_list.json()["items"] == []
    assert user_b_update.status_code == 404
