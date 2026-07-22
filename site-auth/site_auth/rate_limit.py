"""Small in-process rate limiter for the single-instance login service."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
import hashlib
from threading import Lock
import time


@dataclass
class _Bucket:
    failures: deque[float] = field(default_factory=deque)
    blocked_until: float = 0.0


class LoginRateLimiter:
    def __init__(
        self,
        *,
        max_failures: int = 5,
        window_seconds: int = 300,
        block_seconds: int = 900,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if min(max_failures, window_seconds, block_seconds) < 1:
            raise ValueError("rate-limit values must be positive")
        self._max_failures = max_failures
        self._window_seconds = window_seconds
        self._block_seconds = block_seconds
        self._clock = clock
        self._buckets: dict[str, _Bucket] = {}
        self._lock = Lock()

    def can_attempt(self, client_ip: str, identity: str) -> bool:
        now = self._clock()
        with self._lock:
            return all(self._available(key, now) for key in self._keys(client_ip, identity))

    def record_failure(self, client_ip: str, identity: str) -> bool:
        now = self._clock()
        allowed = True
        with self._lock:
            for key in self._keys(client_ip, identity):
                bucket = self._bucket(key, now)
                bucket.failures.append(now)
                if len(bucket.failures) >= self._max_failures:
                    bucket.blocked_until = now + self._block_seconds
                    allowed = False
        return allowed

    def record_success(self, client_ip: str, identity: str) -> None:
        _, identity_key, pair_key = self._keys(client_ip, identity)
        with self._lock:
            self._buckets.pop(identity_key, None)
            self._buckets.pop(pair_key, None)

    def _available(self, key: str, now: float) -> bool:
        bucket = self._bucket(key, now)
        return bucket.blocked_until <= now

    def _bucket(self, key: str, now: float) -> _Bucket:
        bucket = self._buckets.setdefault(key, _Bucket())
        cutoff = now - self._window_seconds
        while bucket.failures and bucket.failures[0] < cutoff:
            bucket.failures.popleft()
        if bucket.blocked_until <= now and not bucket.failures:
            bucket.blocked_until = 0.0
        return bucket

    @staticmethod
    def _keys(client_ip: str, identity: str) -> tuple[str, str, str]:
        normalized_ip = client_ip.strip() or "unknown"
        digest = hashlib.sha256(identity.strip().lower().encode("utf-8")).hexdigest()
        return (
            f"ip:{normalized_ip}",
            f"identity:{digest}",
            f"pair:{normalized_ip}:{digest}",
        )
