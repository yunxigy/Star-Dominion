from __future__ import annotations

import base64

import pytest

from video_downloader.errors import ServiceError
from video_downloader.security import ParseRecordStore, SessionService, TokenService


def test_parse_token_is_bound_to_session_and_expires(settings):
    now = [1000.0]
    clock = lambda: now[0]
    sessions = SessionService(settings.session_ttl_seconds, clock=clock)
    records = ParseRecordStore(settings.parse_token_ttl_seconds, clock=clock)
    tokens = TokenService(
        settings.signing_secret.get_secret_value(),
        settings.parse_token_ttl_seconds,
        clock=clock,
    )

    session = sessions.create()
    payload = {"normalized_url": "https://www.bilibili.com/video/BV1"}
    record = records.put(session.digest, payload)
    token = tokens.issue(record.id, session.digest)

    claims = tokens.verify(token, session.digest)
    assert claims.record_id == record.id
    assert records.get(claims.record_id, session.digest).payload is payload

    with pytest.raises(ServiceError) as crossed:
        tokens.verify(token, sessions.create().digest)
    assert crossed.value.code == "JOB_NOT_FOUND"

    now[0] += settings.parse_token_ttl_seconds + 1
    with pytest.raises(ServiceError) as expired:
        tokens.verify(token, session.digest)
    assert expired.value.code == "JOB_EXPIRED"


def test_tampered_parse_token_is_rejected(settings):
    tokens = TokenService(
        settings.signing_secret.get_secret_value(),
        settings.parse_token_ttl_seconds,
    )
    token = tokens.issue("record-a", "session-a")
    replacement = "a" if token[-1] != "a" else "b"

    with pytest.raises(ServiceError) as caught:
        tokens.verify(f"{token[:-1]}{replacement}", "session-a")

    assert caught.value.code == "JOB_NOT_FOUND"


def test_cookie_value_is_not_embedded_in_token(settings):
    sessions = SessionService(settings.session_ttl_seconds)
    session = sessions.create()
    token = TokenService(
        settings.signing_secret.get_secret_value(),
        settings.parse_token_ttl_seconds,
    ).issue("record-a", session.digest)

    assert session.value not in token
    decoded_segments = []
    for segment in token.split("."):
        try:
            decoded_segments.append(base64.urlsafe_b64decode(f"{segment}===").decode("utf-8", errors="ignore"))
        except ValueError:
            decoded_segments.append("")
    assert all(session.value not in segment for segment in decoded_segments)


def test_session_service_resolves_cookie_and_removes_expired_session(settings):
    now = [10.0]
    sessions = SessionService(settings.session_ttl_seconds, clock=lambda: now[0])
    created = sessions.create()

    assert sessions.resolve(created.value) == created
    assert sessions.resolve("not-a-session") is None

    now[0] += settings.session_ttl_seconds + 1
    assert sessions.resolve(created.value) is None


def test_parse_store_cleans_internal_payload_after_expiry(settings):
    now = [50.0]
    store = ParseRecordStore(settings.parse_token_ttl_seconds, clock=lambda: now[0])
    record = store.put("session-a", {"private": "value"})

    now[0] += settings.parse_token_ttl_seconds + 1

    assert store.cleanup_expired() == 1
    with pytest.raises(ServiceError) as caught:
        store.get(record.id, "session-a")
    assert caught.value.code == "JOB_EXPIRED"


def test_parse_store_hides_record_from_other_sessions(settings):
    store = ParseRecordStore(settings.parse_token_ttl_seconds)
    record = store.put("session-a", object())

    with pytest.raises(ServiceError) as caught:
        store.get(record.id, "session-b")

    assert caught.value.code == "JOB_NOT_FOUND"
