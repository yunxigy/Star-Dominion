"""Bounded OpenAI-compatible provider calls for model discovery and testing."""

from dataclasses import dataclass
import json
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.domain.model_profiles import StoredModelProfile
from app.security.network_policy import AddressResolver, resolve_host_addresses, validate_model_endpoint


class ModelProviderError(RuntimeError):
    code = "MODEL_PROVIDER_ERROR"

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ModelAuthenticationError(ModelProviderError):
    code = "MODEL_AUTH_FAILED"


class ModelQuotaExceededError(ModelProviderError):
    code = "MODEL_QUOTA_EXCEEDED"


class ModelUnavailableError(ModelProviderError):
    code = "MODEL_UNAVAILABLE"


class ModelRateLimitedError(ModelProviderError):
    code = "MODEL_RATE_LIMITED"


class ModelProviderTimeoutError(ModelProviderError):
    code = "MODEL_PROVIDER_TIMEOUT"


class ModelProviderUnavailableError(ModelProviderError):
    code = "MODEL_PROVIDER_UNAVAILABLE"


class ModelProviderRedirectError(ModelProviderError):
    code = "MODEL_PROVIDER_REDIRECTED"


class ModelProviderResponseTooLarge(ModelProviderError):
    code = "MODEL_PROVIDER_RESPONSE_TOO_LARGE"


@dataclass(frozen=True)
class ProviderTestResult:
    ok: bool
    latency_ms: int


@dataclass(frozen=True)
class ProviderProxyResponse:
    status_code: int
    media_type: str
    body: AsyncIterator[bytes]


class OpenAICompatibleProviderClient:
    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        resolver: AddressResolver = resolve_host_addresses,
        production: bool,
        allow_private: bool = False,
        max_response_bytes: int = 2_000_000,
    ) -> None:
        self._transport = transport
        self._resolver = resolver
        self._production = production
        self._allow_private = allow_private
        self._max_response_bytes = max_response_bytes

    async def fetch_models(self, profile: StoredModelProfile, api_key: str) -> list[str]:
        payload = await self._request_json(profile, api_key, method="GET", path="models")
        raw_models = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(raw_models, list):
            raise ModelProviderError("model provider returned an invalid model catalog")
        models: list[str] = []
        seen: set[str] = set()
        for item in raw_models:
            model_id = item.get("id") if isinstance(item, dict) else None
            if not isinstance(model_id, str):
                continue
            normalized = model_id.strip()
            if not normalized or len(normalized) > 300 or normalized in seen:
                continue
            seen.add(normalized)
            models.append(normalized)
        return models

    async def test_chat(
        self,
        profile: StoredModelProfile,
        api_key: str,
        *,
        model: str,
    ) -> ProviderTestResult:
        started = time.monotonic()
        await self._request_json(
            profile,
            api_key,
            method="POST",
            path="chat/completions",
            json_body={
                "model": model,
                "messages": [{"role": "user", "content": "Reply with OK."}],
                "max_tokens": 1,
                "stream": False,
            },
        )
        return ProviderTestResult(ok=True, latency_ms=max(0, int((time.monotonic() - started) * 1000)))

    async def proxy_chat(
        self,
        profile: StoredModelProfile,
        api_key: str,
        payload: dict[str, Any],
    ) -> ProviderProxyResponse:
        base_url = validate_model_endpoint(
            profile.base_url,
            production=self._production,
            allow_private=self._allow_private,
            resolver=self._resolver,
        )
        timeout = httpx.Timeout(
            timeout=float(profile.timeout_seconds),
            connect=min(15.0, float(profile.timeout_seconds)),
        )
        client = httpx.AsyncClient(
            transport=self._transport,
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
        )
        try:
            request = client.build_request(
                "POST",
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "text/event-stream, application/json",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response = await client.send(request, stream=True)
        except httpx.TimeoutException as exc:
            await client.aclose()
            raise ModelProviderTimeoutError("model provider timed out") from exc
        except httpx.RequestError as exc:
            await client.aclose()
            raise ModelProviderUnavailableError("model provider could not be reached") from exc
        if 300 <= response.status_code < 400:
            await response.aclose()
            await client.aclose()
            raise ModelProviderRedirectError(
                "model provider redirects are not allowed", status_code=response.status_code
            )

        async def stream_body() -> AsyncIterator[bytes]:
            size = 0
            try:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > self._max_response_bytes:
                        raise ModelProviderResponseTooLarge(
                            "model provider response exceeded the size limit"
                        )
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        media_type = response.headers.get("content-type", "application/json").split(";", 1)[0]
        return ProviderProxyResponse(
            status_code=response.status_code,
            media_type=media_type,
            body=stream_body(),
        )

    async def _request_json(
        self,
        profile: StoredModelProfile,
        api_key: str,
        *,
        method: str,
        path: str,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        base_url = validate_model_endpoint(
            profile.base_url,
            production=self._production,
            allow_private=self._allow_private,
            resolver=self._resolver,
        )
        timeout = httpx.Timeout(
            timeout=float(profile.timeout_seconds),
            connect=min(15.0, float(profile.timeout_seconds)),
        )
        try:
            async with httpx.AsyncClient(
                transport=self._transport,
                timeout=timeout,
                follow_redirects=False,
                trust_env=False,
            ) as client:
                request = client.build_request(
                    method,
                    f"{base_url}/{path.lstrip('/')}",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json=json_body,
                )
                response = await client.send(request, stream=True)
                try:
                    chunks: list[bytes] = []
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > self._max_response_bytes:
                            raise ModelProviderResponseTooLarge(
                                "model provider response exceeded the size limit"
                            )
                        chunks.append(chunk)
                    raw_content = b"".join(chunks)
                finally:
                    await response.aclose()
        except httpx.TimeoutException as exc:
            raise ModelProviderTimeoutError("model provider timed out") from exc
        except httpx.RequestError as exc:
            raise ModelProviderUnavailableError("model provider could not be reached") from exc
        if 300 <= response.status_code < 400:
            raise ModelProviderRedirectError(
                "model provider redirects are not allowed", status_code=response.status_code
            )
        self._raise_for_status(response)
        try:
            return json.loads(raw_content)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ModelProviderError("model provider returned invalid JSON") from exc

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        status = response.status_code
        if status < 400:
            return
        if status in {401, 403}:
            raise ModelAuthenticationError("model API key is invalid", status_code=status)
        if status == 402:
            raise ModelQuotaExceededError("model quota or balance is insufficient", status_code=status)
        if status == 404:
            raise ModelUnavailableError("model or endpoint was not found", status_code=status)
        if status == 429:
            raise ModelRateLimitedError("model provider rate limited the request", status_code=status)
        if status >= 500:
            raise ModelProviderUnavailableError("model provider is unavailable", status_code=status)
        raise ModelProviderError("model provider rejected the request", status_code=status)
