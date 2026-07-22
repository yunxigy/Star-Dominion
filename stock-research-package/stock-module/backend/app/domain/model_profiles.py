"""Public and server-side models for OpenAI-compatible model profiles."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, SecretStr


ModelProvider = Literal["siliconflow", "openai_compatible"]
ModelProfileScope = Literal["platform", "personal"]


class ModelProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    provider: ModelProvider
    base_url: HttpUrl
    api_key: SecretStr
    timeout_seconds: int = Field(default=120, ge=5, le=300)

    @classmethod
    def siliconflow(cls, *, name: str, api_key: str) -> "ModelProfileCreate":
        return cls(
            name=name,
            provider="siliconflow",
            base_url="https://api.siliconflow.cn/v1",
            api_key=api_key,
            timeout_seconds=120,
        )


class ModelProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    provider: ModelProvider | None = None
    base_url: HttpUrl | None = None
    api_key: SecretStr | None = None
    timeout_seconds: int | None = Field(default=None, ge=5, le=300)
    enabled: bool | None = None


class ModelProfilePublic(BaseModel):
    id: str
    scope: ModelProfileScope
    name: str
    provider: ModelProvider
    base_url: str
    timeout_seconds: int
    enabled: bool
    key_configured: bool
    updated_at: datetime


class PlatformModelProfileConfig(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    provider: ModelProvider
    base_url: HttpUrl
    api_key_env: str = Field(pattern=r"^[A-Z][A-Z0-9_]*$")
    timeout_seconds: int = Field(default=120, ge=5, le=300)
    enabled: bool = True


class ModelConnectionTestRequest(BaseModel):
    model: str | None = Field(default=None, min_length=1, max_length=300)


class ModelConnectionTestResponse(BaseModel):
    ok: bool
    latency_ms: int | None = None
    models: list[str] | None = None


class ModelCatalogResponse(BaseModel):
    items: list[str]


class StoredModelProfile(BaseModel):
    id: str
    owner_id: str
    scope: ModelProfileScope
    name: str
    provider: ModelProvider
    base_url: str
    timeout_seconds: int
    enabled: bool
    secret_ref: str
    created_at: datetime
    updated_at: datetime
