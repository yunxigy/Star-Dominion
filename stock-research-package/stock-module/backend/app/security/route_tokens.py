"""Short-lived HMAC tokens binding an analysis task to one profile and model."""

import base64
from dataclasses import dataclass
import hashlib
import hmac
import json
import time
from collections.abc import Callable
from uuid import uuid4


class InvalidRouteToken(ValueError):
    pass


@dataclass(frozen=True)
class RouteClaims:
    task_id: str
    profile_id: str
    owner_id: str
    model: str
    exp: int
    jti: str


class RouteTokenIssuer:
    def __init__(self, signing_key: str | bytes, *, clock: Callable[[], float] = time.time) -> None:
        self._key = signing_key.encode("utf-8") if isinstance(signing_key, str) else signing_key
        if not self._key:
            raise ValueError("route signing key cannot be empty")
        self._clock = clock

    def issue(
        self,
        *,
        task_id: str,
        profile_id: str,
        owner_id: str,
        model: str,
        ttl_seconds: int,
    ) -> str:
        if not all((task_id, profile_id, owner_id, model)) or ttl_seconds < 1:
            raise ValueError("route token claims must be non-empty")
        payload = {
            "exp": int(self._clock()) + ttl_seconds,
            "jti": uuid4().hex,
            "model": model,
            "owner_id": owner_id,
            "profile_id": profile_id,
            "task_id": task_id,
        }
        encoded = _b64encode(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )
        signature = _b64encode(hmac.new(self._key, encoded.encode("ascii"), hashlib.sha256).digest())
        return f"{encoded}.{signature}"

    def verify(self, token: str, *, task_id: str, model: str) -> RouteClaims:
        claims = self.verify_for_model(token, model=model)
        if claims.task_id != task_id:
            raise InvalidRouteToken("route token does not match the request")
        return claims

    def verify_for_model(self, token: str, *, model: str) -> RouteClaims:
        try:
            encoded, encoded_signature = token.split(".", 1)
            signature = _b64decode(encoded_signature)
            expected = hmac.new(self._key, encoded.encode("ascii"), hashlib.sha256).digest()
            if not hmac.compare_digest(signature, expected):
                raise InvalidRouteToken("route token signature is invalid")
            raw = json.loads(_b64decode(encoded))
            claims = RouteClaims(
                task_id=str(raw["task_id"]),
                profile_id=str(raw["profile_id"]),
                owner_id=str(raw["owner_id"]),
                model=str(raw["model"]),
                exp=int(raw["exp"]),
                jti=str(raw["jti"]),
            )
        except InvalidRouteToken:
            raise
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise InvalidRouteToken("route token is malformed") from exc
        if claims.exp <= int(self._clock()):
            raise InvalidRouteToken("route token has expired")
        if claims.model != model:
            raise InvalidRouteToken("route token does not match the request")
        return claims


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)
