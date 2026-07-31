"""Map unified site-auth identities to local application profiles."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..middleware.site_auth_client import SiteUser
from ..models.user import User


SITE_AUTH_ONLY_PASSWORD = "!site-auth-only!"


class SiteUserProfileConflict(RuntimeError):
    """Raised when a site identity would merge different local profiles."""


def _casefold_match(db: Session, column, value: str) -> User | None:
    return db.scalar(select(User).where(func.lower(column) == value.lower()))


def _assert_identity_fields_available(
    db: Session,
    identity: SiteUser,
    *,
    profile: User,
) -> None:
    username_match = _casefold_match(db, User.username, identity.username)
    email_match = _casefold_match(db, User.email, identity.email)
    conflicting_ids = {
        match.id
        for match in (username_match, email_match)
        if match is not None and match.id != profile.id
    }
    if conflicting_ids:
        raise SiteUserProfileConflict(
            "site identity username or email belongs to another local profile"
        )


def ensure_site_user_profile(db: Session, identity: SiteUser) -> User:
    bound = db.scalar(select(User).where(User.site_user_id == identity.id))
    if bound is not None:
        _assert_identity_fields_available(db, identity, profile=bound)
        bound.username = identity.username
        bound.email = identity.email
        bound.role = identity.role
        bound.is_active = identity.is_active
        db.commit()
        db.refresh(bound)
        return bound

    username_match = _casefold_match(db, User.username, identity.username)
    email_match = _casefold_match(db, User.email, identity.email)
    if (
        username_match is not None
        and email_match is not None
        and username_match.id != email_match.id
    ):
        raise SiteUserProfileConflict(
            "site identity username and email belong to different local profiles"
        )

    profile = username_match or email_match
    if profile is None:
        profile = User(
            username=identity.username,
            email=identity.email,
            password_hash=SITE_AUTH_ONLY_PASSWORD,
        )
        db.add(profile)
    else:
        profile.username = identity.username
        profile.email = identity.email

    profile.site_user_id = identity.id
    profile.role = identity.role
    profile.is_active = identity.is_active
    db.commit()
    db.refresh(profile)
    return profile
