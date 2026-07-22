"""Business rules for personal model profiles."""

from datetime import UTC, datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING
from uuid import uuid4

from app.domain.model_profiles import (
    ModelProfileCreate,
    ModelProfilePublic,
    ModelProfileUpdate,
    PlatformModelProfileConfig,
    StoredModelProfile,
)
from app.repositories.model_profiles import ModelProfileRepository
from app.security.secrets import SecretStore

if TYPE_CHECKING:
    from app.integrations.model_providers import OpenAICompatibleProviderClient, ProviderTestResult


class ModelProfileNotFound(LookupError):
    pass


class ModelProfileService:
    def __init__(
        self,
        repository: ModelProfileRepository,
        secrets: SecretStore,
        *,
        owner_id: str,
        provider_client: "OpenAICompatibleProviderClient | None" = None,
        platform_profiles: tuple[PlatformModelProfileConfig, ...] = (),
        environment: Mapping[str, str] | None = None,
    ) -> None:
        self._repository = repository
        self._secrets = secrets
        self._owner_id = owner_id
        self.provider_client = provider_client
        self._platform_profiles = {item.id: item for item in platform_profiles}
        self._environment = environment or {}
        self._sync_platform_profiles()

    def create(self, request: ModelProfileCreate) -> ModelProfilePublic:
        now = datetime.now(UTC)
        profile_id = str(uuid4())
        record = StoredModelProfile(
            id=profile_id,
            owner_id=self._owner_id,
            scope="personal",
            name=request.name,
            provider=request.provider,
            base_url=str(request.base_url).rstrip("/"),
            timeout_seconds=request.timeout_seconds,
            enabled=True,
            secret_ref=profile_id,
            created_at=now,
            updated_at=now,
        )
        self._repository.save_profile(record)
        try:
            self._secrets.put(record.secret_ref, request.api_key.get_secret_value())
        except Exception:
            self._repository.delete_profile(record.id, owner_id=self._owner_id)
            raise
        return self._to_public(record)

    def update(self, profile_id: str, request: ModelProfileUpdate) -> ModelProfilePublic:
        current = self._require_personal(profile_id)
        values = request.model_dump(exclude_unset=True, exclude={"api_key"})
        if "base_url" in values:
            values["base_url"] = str(values["base_url"]).rstrip("/")
        updated = current.model_copy(update={**values, "updated_at": datetime.now(UTC)})
        self._repository.save_profile(updated)
        if request.api_key is not None:
            self._secrets.put(updated.secret_ref, request.api_key.get_secret_value())
        return self._to_public(updated)

    def delete(self, profile_id: str) -> None:
        current = self._require_personal(profile_id)
        if not self._repository.delete_profile(current.id, owner_id=self._owner_id):
            raise ModelProfileNotFound(profile_id)

    def get_personal_record(self, profile_id: str) -> StoredModelProfile:
        return self._require_personal(profile_id)

    def list_personal(self) -> list[ModelProfilePublic]:
        return [self._to_public(item) for item in self._repository.list_profiles(owner_id=self._owner_id)]

    def list_available(self) -> list[ModelProfilePublic]:
        platform = [
            self._to_public(item)
            for item in self._repository.list_profiles(owner_id="platform")
        ]
        return platform + self.list_personal()

    def get_available_record(self, profile_id: str) -> StoredModelProfile:
        return self._require_available(profile_id)

    def for_owner(self, owner_id: str) -> "ModelProfileService":
        """Bind the shared repositories and provider client to one authenticated user."""
        return ModelProfileService(
            self._repository,
            self._secrets,
            owner_id=owner_id,
            provider_client=self.provider_client,
            platform_profiles=tuple(self._platform_profiles.values()),
            environment=self._environment,
        )

    def resolve_credentials(
        self,
        profile_id: str,
        *,
        owner_id: str,
    ) -> tuple[StoredModelProfile, str]:
        profile = self._repository.get_profile(profile_id, owner_id=owner_id)
        if profile is None:
            raise ModelProfileNotFound(profile_id)
        if profile.owner_id != owner_id or not profile.enabled:
            raise ModelProfileNotFound(profile_id)
        return profile, self._api_key_for(profile)

    async def refresh_models(self, profile_id: str) -> list[str]:
        client = self._require_provider_client()
        profile = self._require_available(profile_id)
        api_key = self._api_key_for(profile)
        models = await client.fetch_models(profile, api_key)
        self._repository.save_catalog(profile.id, models, ttl_seconds=900)
        return models

    async def get_models(self, profile_id: str) -> list[str]:
        self._require_available(profile_id)
        cached = self._repository.get_catalog(profile_id)
        if cached is not None and cached[1] > datetime.now(UTC):
            return cached[0]
        return await self.refresh_models(profile_id)

    async def test_connection(self, profile_id: str, *, model: str | None = None) -> "ProviderTestResult | list[str]":
        client = self._require_provider_client()
        profile = self._require_available(profile_id)
        api_key = self._api_key_for(profile)
        if model:
            return await client.test_chat(profile, api_key, model=model)
        return await client.fetch_models(profile, api_key)

    def _require_personal(self, profile_id: str) -> StoredModelProfile:
        profile = self._repository.get_profile(profile_id, owner_id=self._owner_id)
        if profile is None:
            raise ModelProfileNotFound(profile_id)
        return profile

    def _require_available(self, profile_id: str) -> StoredModelProfile:
        personal = self._repository.get_profile(profile_id, owner_id=self._owner_id)
        if personal is not None:
            return personal
        platform = self._repository.get_profile(profile_id, owner_id="platform")
        if platform is not None:
            return platform
        raise ModelProfileNotFound(profile_id)

    def _to_public(self, profile: StoredModelProfile) -> ModelProfilePublic:
        return ModelProfilePublic(
            id=profile.id,
            scope=profile.scope,
            name=profile.name,
            provider=profile.provider,
            base_url=profile.base_url,
            timeout_seconds=profile.timeout_seconds,
            enabled=profile.enabled,
            key_configured=self._key_configured(profile),
            updated_at=profile.updated_at,
        )

    def _require_provider_client(self) -> "OpenAICompatibleProviderClient":
        if self.provider_client is None:
            raise RuntimeError("model provider client is not configured")
        return self.provider_client

    def _api_key_for(self, profile: StoredModelProfile) -> str:
        if profile.scope == "platform":
            variable = profile.secret_ref.removeprefix("env:")
            value = self._environment.get(variable, "").strip()
            if not value:
                raise KeyError("platform model API key is not configured")
            return value
        return self._secrets.get(profile.secret_ref)

    def _key_configured(self, profile: StoredModelProfile) -> bool:
        if profile.scope == "platform":
            variable = profile.secret_ref.removeprefix("env:")
            return bool(self._environment.get(variable, "").strip())
        return self._repository.read_secret_ciphertext(profile.secret_ref) is not None

    def _sync_platform_profiles(self) -> None:
        now = datetime.now(UTC)
        for item in self._platform_profiles.values():
            self._repository.save_profile(
                StoredModelProfile(
                    id=item.id,
                    owner_id="platform",
                    scope="platform",
                    name=item.name,
                    provider=item.provider,
                    base_url=str(item.base_url).rstrip("/"),
                    timeout_seconds=item.timeout_seconds,
                    enabled=item.enabled,
                    secret_ref=f"env:{item.api_key_env}",
                    created_at=now,
                    updated_at=now,
                )
            )
