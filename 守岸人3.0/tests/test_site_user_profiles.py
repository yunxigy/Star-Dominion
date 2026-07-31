from __future__ import annotations

from server.middleware.site_auth_client import SiteUser
from server.models.user import User


def test_existing_local_user_is_bound_without_changing_primary_key(db_session):
    from server.services.site_user_profiles import ensure_site_user_profile

    local = User(
        id="legacy-admin",
        username="admin",
        email="admin@shouanren.com",
        password_hash="legacy-disabled",
        role="admin",
    )
    db_session.add(local)
    db_session.commit()

    identity = SiteUser(
        id="site-admin",
        username="admin",
        email="admin@local.invalid",
        role="admin",
    )
    resolved = ensure_site_user_profile(db_session, identity)

    assert resolved.id == "legacy-admin"
    assert resolved.site_user_id == "site-admin"
    assert resolved.username == "admin"
    assert resolved.email == "admin@local.invalid"
    assert resolved.role == "admin"


def test_new_site_user_gets_non_login_shadow_profile(db_session):
    from server.services.site_user_profiles import ensure_site_user_profile

    identity = SiteUser(
        id="site-reader",
        username="reader",
        email="reader@example.com",
        role="user",
    )

    resolved = ensure_site_user_profile(db_session, identity)

    assert resolved.site_user_id == "site-reader"
    assert resolved.password_hash == "!site-auth-only!"


def test_conflicting_username_and_email_are_rejected(db_session):
    from server.services.site_user_profiles import (
        SiteUserProfileConflict,
        ensure_site_user_profile,
    )

    db_session.add_all(
        [
            User(
                id="username-owner",
                username="reader",
                email="first@example.com",
                password_hash="legacy-disabled",
            ),
            User(
                id="email-owner",
                username="someone-else",
                email="reader@example.com",
                password_hash="legacy-disabled",
            ),
        ]
    )
    db_session.commit()

    identity = SiteUser(
        id="site-reader",
        username="reader",
        email="reader@example.com",
        role="user",
    )

    try:
        ensure_site_user_profile(db_session, identity)
    except SiteUserProfileConflict:
        pass
    else:
        raise AssertionError("conflicting local profiles must not be merged")
