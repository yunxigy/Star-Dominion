from __future__ import annotations

import pytest

from video_downloader.errors import ServiceError
from video_downloader.rate_limit import ClientIpResolver, SlidingWindowRateLimiter


def test_parse_limit_allows_ten_requests_and_rejects_the_eleventh(settings):
    now = [100.0]
    limiter = SlidingWindowRateLimiter(settings, clock=lambda: now[0])

    for _ in range(settings.parse_rate_limit):
        limiter.consume("203.0.113.10", "parse")

    with pytest.raises(ServiceError) as caught:
        limiter.consume("203.0.113.10", "parse")

    assert caught.value.code == "RATE_LIMITED"
    assert caught.value.http_status == 429
    assert caught.value.retryable is True
    assert caught.value.retry_after_seconds == settings.parse_rate_window_seconds


def test_parse_limit_recovers_after_the_window(settings):
    now = [100.0]
    limiter = SlidingWindowRateLimiter(settings, clock=lambda: now[0])
    for _ in range(settings.parse_rate_limit):
        limiter.consume("203.0.113.10", "parse")

    now[0] += settings.parse_rate_window_seconds + 0.001

    limiter.consume("203.0.113.10", "parse")


def test_download_limit_is_independent_for_each_ip(settings):
    limiter = SlidingWindowRateLimiter(settings, clock=lambda: 100.0)
    for _ in range(settings.download_rate_limit):
        limiter.consume("203.0.113.10", "download")

    limiter.consume("203.0.113.11", "download")
    with pytest.raises(ServiceError) as caught:
        limiter.consume("203.0.113.10", "download")
    assert caught.value.code == "RATE_LIMITED"


def test_unknown_rate_limit_action_is_a_programming_error(settings):
    limiter = SlidingWindowRateLimiter(settings)

    with pytest.raises(ValueError, match="unknown rate limit action"):
        limiter.consume("203.0.113.10", "unknown")


def test_untrusted_peer_cannot_spoof_forwarded_client(settings):
    resolver = ClientIpResolver(settings.trusted_proxy_networks)

    assert resolver.resolve("198.51.100.20", "203.0.113.10") == "198.51.100.20"


def test_trusted_proxy_uses_first_valid_forwarded_client(settings):
    resolver = ClientIpResolver(settings.trusted_proxy_networks)

    assert resolver.resolve("127.0.0.1", "203.0.113.10, 127.0.0.1") == "203.0.113.10"


@pytest.mark.parametrize("header", [None, "", "not-an-ip", "not-an-ip, 203.0.113.10"])
def test_invalid_forwarded_header_falls_back_to_peer(settings, header):
    resolver = ClientIpResolver(settings.trusted_proxy_networks)

    assert resolver.resolve("127.0.0.1", header) == "127.0.0.1"
