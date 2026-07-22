from site_auth.rate_limit import LoginRateLimiter


def test_failed_logins_are_temporarily_rate_limited() -> None:
    now = [1000.0]
    limiter = LoginRateLimiter(
        max_failures=3,
        window_seconds=60,
        block_seconds=120,
        clock=lambda: now[0],
    )

    assert limiter.can_attempt("127.0.0.1", "admin")
    assert limiter.record_failure("127.0.0.1", "admin")
    assert limiter.record_failure("127.0.0.1", "admin")
    assert not limiter.record_failure("127.0.0.1", "admin")
    assert not limiter.can_attempt("127.0.0.1", "admin")

    now[0] += 121
    assert limiter.can_attempt("127.0.0.1", "admin")


def test_success_clears_identity_failures_without_clearing_other_identity() -> None:
    limiter = LoginRateLimiter(max_failures=2)
    limiter.record_failure("127.0.0.1", "admin")
    limiter.record_failure("127.0.0.2", "other")
    limiter.record_failure("127.0.0.2", "other")

    limiter.record_success("127.0.0.1", "admin")

    assert limiter.can_attempt("127.0.0.1", "admin")
    assert not limiter.can_attempt("127.0.0.2", "other")
