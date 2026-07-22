from datetime import UTC, datetime
import json
from pathlib import Path

from cryptography.fernet import Fernet
import httpx
import pytest

from app.domain.model_profiles import ModelProfileCreate, StoredModelProfile
from app.integrations.model_providers import (
    ModelAuthenticationError,
    ModelProviderRedirectError,
    ModelProviderResponseTooLarge,
    OpenAICompatibleProviderClient,
)
from app.repositories.model_profiles import ModelProfileRepository
from app.security.network_policy import UnsafeModelEndpoint, validate_model_endpoint
from app.security.secrets import FernetSecretStore
from app.services.model_profiles import ModelProfileService


PUBLIC_RESOLVER = lambda _: ["93.184.216.34"]


@pytest.mark.parametrize(
    "url,resolved",
    [
        ("http://127.0.0.1:8000/v1", ["127.0.0.1"]),
        ("https://internal.example/v1", ["10.0.0.1"]),
        ("https://metadata.example/latest", ["169.254.169.254"]),
        ("https://user:pass@example.com/v1", ["93.184.216.34"]),
    ],
)
def test_production_blocks_private_or_credentialed_urls(url: str, resolved: list[str]) -> None:
    with pytest.raises(UnsafeModelEndpoint):
        validate_model_endpoint(
            url,
            production=True,
            allow_private=False,
            resolver=lambda _: resolved,
        )


def test_development_allows_loopback_only_when_explicitly_enabled() -> None:
    with pytest.raises(UnsafeModelEndpoint):
        validate_model_endpoint(
            "http://127.0.0.1:11434/v1",
            production=False,
            allow_private=False,
            resolver=lambda _: ["127.0.0.1"],
        )

    assert validate_model_endpoint(
        "http://127.0.0.1:11434/v1",
        production=False,
        allow_private=True,
        resolver=lambda _: ["127.0.0.1"],
    ) == "http://127.0.0.1:11434/v1"


@pytest.mark.asyncio
async def test_fetch_models_uses_server_key_and_filters_ids() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "deepseek-ai/DeepSeek-V4-Flash"},
                    {"id": ""},
                    {"wrong": "ignored"},
                    {"id": "Qwen/Qwen3.6-27B"},
                    {"id": "deepseek-ai/DeepSeek-V4-Flash"},
                ]
            },
        )

    client = OpenAICompatibleProviderClient(
        transport=httpx.MockTransport(handler),
        resolver=PUBLIC_RESOLVER,
        production=True,
    )

    result = await client.fetch_models(_profile(), "secret")

    assert result == ["deepseek-ai/DeepSeek-V4-Flash", "Qwen/Qwen3.6-27B"]
    headers = captured["headers"]
    assert isinstance(headers, httpx.Headers)
    assert headers["Authorization"] == "Bearer secret"
    assert captured["url"] == "https://api.siliconflow.cn/v1/models"


@pytest.mark.asyncio
async def test_provider_does_not_follow_redirects() -> None:
    client = OpenAICompatibleProviderClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(302, headers={"Location": "http://127.0.0.1/private"})
        ),
        resolver=PUBLIC_RESOLVER,
        production=True,
    )

    with pytest.raises(ModelProviderRedirectError):
        await client.fetch_models(_profile(), "secret")


@pytest.mark.asyncio
async def test_provider_classifies_authentication_and_response_size() -> None:
    auth_client = OpenAICompatibleProviderClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(401, json={"error": "bad key"})),
        resolver=PUBLIC_RESOLVER,
        production=True,
    )
    with pytest.raises(ModelAuthenticationError):
        await auth_client.fetch_models(_profile(), "secret")

    large_client = OpenAICompatibleProviderClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"x" * 1025)),
        resolver=PUBLIC_RESOLVER,
        production=True,
        max_response_bytes=1024,
    )
    with pytest.raises(ModelProviderResponseTooLarge):
        await large_client.fetch_models(_profile(), "secret")


@pytest.mark.asyncio
async def test_manual_chat_test_sends_selected_model() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"role": "assistant", "content": "ok"}}]},
        )

    client = OpenAICompatibleProviderClient(
        transport=httpx.MockTransport(handler),
        resolver=PUBLIC_RESOLVER,
        production=True,
    )

    result = await client.test_chat(_profile(), "secret", model="manual-model")

    assert result.ok is True
    assert captured["model"] == "manual-model"
    assert captured["max_tokens"] == 1


@pytest.mark.asyncio
async def test_catalog_cache_survives_refresh_failure(tmp_path: Path) -> None:
    repository = ModelProfileRepository(tmp_path / "hub.db")
    secrets = FernetSecretStore(repository, Fernet.generate_key().decode("ascii"))
    working_client = OpenAICompatibleProviderClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"data": [{"id": "model-a"}]})
        ),
        resolver=PUBLIC_RESOLVER,
        production=True,
    )
    service = ModelProfileService(
        repository,
        secrets,
        owner_id="local",
        provider_client=working_client,
    )
    profile = service.create(ModelProfileCreate.siliconflow(name="SF", api_key="secret"))
    assert await service.refresh_models(profile.id) == ["model-a"]

    failing_client = OpenAICompatibleProviderClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(503)),
        resolver=PUBLIC_RESOLVER,
        production=True,
    )
    service.provider_client = failing_client

    with pytest.raises(Exception):
        await service.refresh_models(profile.id)

    cached = repository.get_catalog(profile.id)
    assert cached is not None
    assert cached[0] == ["model-a"]


def _profile() -> StoredModelProfile:
    now = datetime.now(UTC)
    return StoredModelProfile(
        id="profile-1",
        owner_id="local",
        scope="personal",
        name="硅基流动",
        provider="siliconflow",
        base_url="https://api.siliconflow.cn/v1",
        timeout_seconds=120,
        enabled=True,
        secret_ref="profile-1",
        created_at=now,
        updated_at=now,
    )
