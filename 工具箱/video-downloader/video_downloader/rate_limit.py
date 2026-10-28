from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable
from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network, ip_address
from typing import Literal

from .config import VideoSettings
from .errors import ServiceError

RateAction = Literal["parse", "download"]


class SlidingWindowRateLimiter:
    def __init__(
        self,
        settings: VideoSettings,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._settings = settings
        self._clock = clock or time.monotonic
        self._events: dict[tuple[str, RateAction], deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def consume(self, client_ip: str, action: str) -> None:
        if action == "parse":
            limit = self._settings.parse_rate_limit
            window = self._settings.parse_rate_window_seconds
        elif action == "download":
            limit = self._settings.download_rate_limit
            window = self._settings.download_rate_window_seconds
        else:
            raise ValueError(f"unknown rate limit action: {action}")

        typed_action: RateAction = action
        now = self._clock()
        key = (client_ip, typed_action)
        with self._lock:
            events = self._events[key]
            while events and now - events[0] >= window:
                events.popleft()
            if len(events) >= limit:
                retry_after = max(1, math.ceil(events[0] + window - now))
                raise ServiceError(
                    "RATE_LIMITED",
                    "请求过于频繁，请稍后重试。",
                    429,
                    retryable=True,
                    retry_after_seconds=retry_after,
                )
            events.append(now)


class ClientIpResolver:
    def __init__(
        self,
        trusted_proxies: tuple[IPv4Network | IPv6Network, ...],
    ) -> None:
        self._trusted_proxies = trusted_proxies

    def resolve(self, peer_host: str | None, forwarded_for: str | None) -> str:
        peer = self._parse_ip(peer_host)
        if peer is None:
            return "unknown"
        if not self._is_trusted(peer) or not forwarded_for:
            return str(peer)

        first = forwarded_for.split(",", 1)[0].strip()
        forwarded = self._parse_ip(first)
        return str(forwarded) if forwarded is not None else str(peer)

    def _is_trusted(self, address: IPv4Address | IPv6Address) -> bool:
        return any(
            address.version == network.version and address in network
            for network in self._trusted_proxies
        )

    @staticmethod
    def _parse_ip(value: str | None) -> IPv4Address | IPv6Address | None:
        if not value:
            return None
        try:
            return ip_address(value.strip())
        except ValueError:
            return None
