from __future__ import annotations

import hashlib
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from itsdangerous import BadData, URLSafeSerializer

from .errors import ServiceError


@dataclass(frozen=True)
class AnonymousSession:
    value: str
    digest: str
    expires_at: float


class SessionService:
    def __init__(
        self,
        ttl_seconds: int,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._clock = clock or time.time
        self._sessions: dict[str, AnonymousSession] = {}

    def create(self) -> AnonymousSession:
        value = secrets.token_urlsafe(32)
        digest = self.digest(value)
        session = AnonymousSession(
            value=value,
            digest=digest,
            expires_at=self._clock() + self._ttl_seconds,
        )
        self._sessions[digest] = session
        return session

    def resolve(self, value: str | None) -> AnonymousSession | None:
        if not value:
            return None
        digest = self.digest(value)
        session = self._sessions.get(digest)
        if session is None:
            return None
        if session.expires_at <= self._clock():
            self._sessions.pop(digest, None)
            return None
        return session

    def cleanup_expired(self) -> int:
        now = self._clock()
        expired = [digest for digest, session in self._sessions.items() if session.expires_at <= now]
        for digest in expired:
            self._sessions.pop(digest, None)
        return len(expired)

    @staticmethod
    def digest(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ParseRecord:
    id: str
    session_digest: str
    payload: Any
    created_at: float
    expires_at: float


@dataclass(frozen=True)
class _ExpiredRecord:
    session_digest: str
    forget_at: float


class ParseRecordStore:
    def __init__(
        self,
        ttl_seconds: int,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._clock = clock or time.time
        self._records: dict[str, ParseRecord] = {}
        self._expired: dict[str, _ExpiredRecord] = {}

    def put(self, session_digest: str, payload: Any) -> ParseRecord:
        now = self._clock()
        record = ParseRecord(
            id=uuid4().hex,
            session_digest=session_digest,
            payload=payload,
            created_at=now,
            expires_at=now + self._ttl_seconds,
        )
        self._records[record.id] = record
        return record

    def get(self, record_id: str, session_digest: str) -> ParseRecord:
        record = self._records.get(record_id)
        if record is None:
            expired = self._expired.get(record_id)
            if expired is not None and secrets.compare_digest(expired.session_digest, session_digest):
                raise self._expired_error()
            raise self._not_found_error()
        if not secrets.compare_digest(record.session_digest, session_digest):
            raise self._not_found_error()
        if record.expires_at <= self._clock():
            self._expire(record)
            raise self._expired_error()
        return record

    def cleanup_expired(self) -> int:
        now = self._clock()
        expired_records = [record for record in self._records.values() if record.expires_at <= now]
        for record in expired_records:
            self._expire(record)
        forgotten = [record_id for record_id, record in self._expired.items() if record.forget_at <= now]
        for record_id in forgotten:
            self._expired.pop(record_id, None)
        return len(expired_records)

    def _expire(self, record: ParseRecord) -> None:
        self._records.pop(record.id, None)
        self._expired[record.id] = _ExpiredRecord(
            session_digest=record.session_digest,
            forget_at=self._clock() + self._ttl_seconds,
        )

    @staticmethod
    def _not_found_error() -> ServiceError:
        return ServiceError("JOB_NOT_FOUND", "解析记录不存在或无权访问。", 404)

    @staticmethod
    def _expired_error() -> ServiceError:
        return ServiceError("JOB_EXPIRED", "解析凭证已过期，请重新解析。", 410)


@dataclass(frozen=True)
class TokenClaims:
    record_id: str
    session_digest: str
    expires_at: float


class TokenService:
    def __init__(
        self,
        secret_key: str,
        ttl_seconds: int,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._serializer = URLSafeSerializer(secret_key, salt="sd-video-parse-v1")
        self._ttl_seconds = ttl_seconds
        self._clock = clock or time.time

    def issue(self, record_id: str, session_digest: str) -> str:
        return self._serializer.dumps(
            {
                "recordId": record_id,
                "sessionDigest": session_digest,
                "expiresAt": self._clock() + self._ttl_seconds,
            }
        )

    def verify(self, token: str, session_digest: str) -> TokenClaims:
        try:
            payload = self._serializer.loads(token)
        except BadData as exc:
            raise self._not_found_error() from exc
        if not isinstance(payload, dict):
            raise self._not_found_error()

        record_id = payload.get("recordId")
        claimed_digest = payload.get("sessionDigest")
        expires_at = payload.get("expiresAt")
        if not isinstance(record_id, str) or not isinstance(claimed_digest, str):
            raise self._not_found_error()
        if not isinstance(expires_at, (int, float)) or isinstance(expires_at, bool):
            raise self._not_found_error()
        if not secrets.compare_digest(claimed_digest, session_digest):
            raise self._not_found_error()
        if float(expires_at) <= self._clock():
            raise ServiceError("JOB_EXPIRED", "解析凭证已过期，请重新解析。", 410)
        return TokenClaims(
            record_id=record_id,
            session_digest=claimed_digest,
            expires_at=float(expires_at),
        )

    @staticmethod
    def _not_found_error() -> ServiceError:
        return ServiceError("JOB_NOT_FOUND", "解析凭证无效。", 404)
