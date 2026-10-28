from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class HttpCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: HttpUrl


class DnsCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hostname: str = Field(min_length=1, max_length=253, pattern=r"^[A-Za-z0-9.-]+$")


class SslCheckRequest(DnsCheckRequest):
    port: Literal[443] = 443


class WebSocketCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=6, max_length=2048, pattern=r"^wss?://")


class InspectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    elapsed_ms: int = Field(ge=0, le=120_000)
    resolved_addresses: list[str] = Field(default_factory=list, max_length=32)
    headers: dict[str, str] = Field(default_factory=dict, max_length=50)
    redirect_chain: list[str] = Field(default_factory=list, max_length=4)
    detail: str | None = None


class DnsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hostname: str
    addresses: list[str] = Field(default_factory=list, max_length=32)
    elapsed_ms: int = Field(ge=0, le=120_000)


class SslResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hostname: str
    port: int = 443
    protocol: str
    cipher: str | None = None
    subject: str | None = None
    issuer: str | None = None
    not_before: str | None = None
    not_after: str | None = None
    san_count: int = Field(default=0, ge=0)
    elapsed_ms: int = Field(ge=0, le=120_000)
    resolved_addresses: list[str] = Field(default_factory=list, max_length=32)


class WebSocketResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    handshake_ok: bool
    elapsed_ms: int = Field(ge=0, le=120_000)
    resolved_addresses: list[str] = Field(default_factory=list, max_length=32)
    detail: str | None = None


JsonObject = dict[str, Any]
