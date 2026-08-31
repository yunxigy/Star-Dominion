def test_contract_builds_forwarded_context() -> None:
    from shared.site_auth_contract import build_forwarded_context

    headers, cookies = build_forwarded_context(
        origin="http://127.0.0.1:8013", csrf="csrf-value", session="session-value"
    )
    assert headers["X-Site-Request-Origin"] == "http://127.0.0.1:8013"
    assert headers["X-Site-CSRF"] == "csrf-value"
    assert cookies == {"sd_session": "session-value", "sd_csrf": "csrf-value"}
