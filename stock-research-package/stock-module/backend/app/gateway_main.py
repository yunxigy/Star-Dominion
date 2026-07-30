"""Uvicorn entry point for the separately served internal model gateway."""

from collections.abc import Mapping
import os

from fastapi import FastAPI

from app.config import Settings
from app.gateway import create_gateway_app
from app.integrations.model_providers import OpenAICompatibleProviderClient
from app.repositories.model_profiles import ModelProfileRepository
from app.security.route_tokens import RouteTokenIssuer
from app.security.secrets import FernetSecretStore
from app.services.model_profiles import ModelProfileService


def build_gateway_app(
    *,
    settings: Settings | None = None,
    environment: Mapping[str, str] | None = None,
) -> FastAPI:
    configured = settings or Settings.from_env()
    repository = ModelProfileRepository(configured.data_dir / "hub.db")
    secrets = FernetSecretStore(repository, configured.model_master_key)
    provider = OpenAICompatibleProviderClient(
        production=configured.environment == "production",
        allow_private=configured.allow_private_model_endpoints,
    )
    profiles = ModelProfileService(
        repository,
        secrets,
        owner_id="local",
        provider_client=provider,
        platform_profiles=configured.platform_model_profiles,
        environment=environment if environment is not None else os.environ,
    )
    return create_gateway_app(
        settings=configured,
        profiles=profiles,
        provider_client=provider,
        route_issuer=RouteTokenIssuer(configured.route_signing_key),
    )


app = build_gateway_app()
