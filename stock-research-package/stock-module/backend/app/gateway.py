"""Private OpenAI-compatible gateway served separately from the public stock API."""

import hmac
import json
from typing import Any

from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse

from app.config import Settings
from app.integrations.model_providers import ModelProviderError, OpenAICompatibleProviderClient
from app.security.route_tokens import InvalidRouteToken, RouteTokenIssuer
from app.services.model_profiles import ModelProfileNotFound, ModelProfileService


MAX_GATEWAY_REQUEST_BYTES = 1_000_000


def create_gateway_app(
    *,
    settings: Settings,
    profiles: ModelProfileService,
    provider_client: OpenAICompatibleProviderClient,
    route_issuer: RouteTokenIssuer | None = None,
) -> FastAPI:
    issuer = route_issuer or RouteTokenIssuer(settings.route_signing_key)
    application = FastAPI(
        title="Star Dominion Internal Model Gateway",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @application.post("/v1/chat/completions")
    async def chat_completions(
        payload: dict[str, Any] = Body(),
        service_token: str = Header(alias="X-Stock-Service-Token"),
        route_token: str = Header(alias="X-Stock-Model-Route"),
        task_id: str | None = Header(default=None, alias="X-Stock-Analysis-Task"),
    ) -> StreamingResponse:
        if not hmac.compare_digest(service_token, settings.gateway_service_token):
            raise _unauthorized()
        if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > MAX_GATEWAY_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail={"code": "MODEL_REQUEST_TOO_LARGE"})
        model = payload.get("model")
        if not isinstance(model, str) or not model.strip():
            raise _unauthorized()
        try:
            claims = (
                issuer.verify(route_token, task_id=task_id, model=model)
                if task_id is not None
                else issuer.verify_for_model(route_token, model=model)
            )
            profile, api_key = profiles.resolve_credentials(
                claims.profile_id,
                owner_id=claims.owner_id,
            )
            upstream = await provider_client.proxy_chat(profile, api_key, payload)
        except (InvalidRouteToken, ModelProfileNotFound, KeyError):
            raise _unauthorized()
        except ModelProviderError as exc:
            raise HTTPException(
                status_code=502,
                detail={"code": exc.code, "message": "模型服务请求失败"},
            ) from exc
        return StreamingResponse(
            upstream.body,
            status_code=upstream.status_code,
            media_type=upstream.media_type,
        )

    return application


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": "INVALID_MODEL_ROUTE", "message": "模型路由无效"},
    )
