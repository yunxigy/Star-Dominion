"""Opaque browser-session lifecycle and CSRF validation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from .models import Session, User


SESSION_COOKIE = "sd_session"
CSRF_COOKIE = "sd_csrf"
SESSION_TTL = timedelta(days=7)
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass(frozen=True, slots=True)
class NewSession:
    token: str
    csrf_token: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    session: Session
    user: User


class SessionService:
    def create(self, db: OrmSession, user: User) -> NewSession:
        token = secrets.token_urlsafe(32)
        csrf_token = secrets.token_urlsafe(32)
        expires_at = _utcnow() + SESSION_TTL
        db.add(
            Session(
                user_id=user.id,
                token_hash=_digest(token),
                csrf_hash=_digest(csrf_token),
                expires_at=expires_at,
            )
        )
        db.commit()
        return NewSession(token=token, csrf_token=csrf_token, expires_at=expires_at)

    def authenticate(
        self,
        db: OrmSession,
        token: str | None,
    ) -> AuthenticatedSession | None:
        if not token:
            return None
        stored = db.scalar(select(Session).where(Session.token_hash == _digest(token)))
        if stored is None or stored.revoked_at is not None:
            return None
        if _as_utc(stored.expires_at) <= _utcnow():
            return None
        user = db.get(User, stored.user_id)
        if user is None or not user.is_active:
            return None
        return AuthenticatedSession(session=stored, user=user)

    def validate_request(
        self,
        authenticated: AuthenticatedSession,
        *,
        method: str,
        origin: str | None,
        csrf_cookie: str | None,
        csrf_header: str | None,
        allowed_origins: tuple[str, ...],
    ) -> bool:
        if method.upper() in SAFE_METHODS:
            return True
        if not origin or origin.rstrip("/") not in allowed_origins:
            return False
        if not csrf_cookie or not csrf_header:
            return False
        if not hmac.compare_digest(csrf_cookie, csrf_header):
            return False
        return hmac.compare_digest(
            authenticated.session.csrf_hash,
            _digest(csrf_cookie),
        )

    def revoke(self, db: OrmSession, authenticated: AuthenticatedSession) -> None:
        authenticated.session.revoked_at = _utcnow()
        db.commit()
