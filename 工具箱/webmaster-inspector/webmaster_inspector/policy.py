from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
from dataclasses import dataclass
from urllib.parse import SplitResult, urljoin, urlsplit


class TargetBlockedError(ValueError):
    """Raised when a target is not safe for outbound inspection."""


@dataclass(frozen=True)
class ValidatedTarget:
    scheme: str
    host: str
    port: int
    path: str
    ip: str

    @property
    def path_query(self) -> str:
        return self.path or "/"


def _normalize_host(host: str) -> str:
    if not host:
        raise TargetBlockedError("目标地址被安全策略拦截")
    try:
        normalized = host.encode("idna").decode("ascii").rstrip(".").lower()
    except UnicodeError as exc:
        raise TargetBlockedError("目标地址被安全策略拦截") from exc
    try:
        literal = ipaddress.ip_address(normalized)
    except ValueError:
        literal = None
    if literal is not None:
        raise TargetBlockedError("目标地址被安全策略拦截")
    if not normalized or len(normalized) > 253:
        raise TargetBlockedError("目标地址被安全策略拦截")
    return normalized


def _addresses_from_answers(answers: list[tuple]) -> list[str]:
    values: list[str] = []
    for answer in answers:
        try:
            candidate = answer[4][0] if len(answer) > 4 else answer[0]
            address = ipaddress.ip_address(candidate)
        except (IndexError, ValueError, TypeError):
            continue
        if not address.is_global:
            raise TargetBlockedError("目标地址被安全策略拦截")
        values.append(str(address))
    if not values:
        raise TargetBlockedError("目标地址被安全策略拦截")
    return list(dict.fromkeys(values))


def resolve_public_addresses(host: str, port: int = 443, resolver=None) -> list[str]:
    normalized = _normalize_host(host)
    resolver = resolver or socket.getaddrinfo
    try:
        answers = resolver(normalized, port, type=socket.SOCK_STREAM)
    except TypeError:
        answers = resolver(normalized, port)
    except OSError as exc:
        raise TargetBlockedError("目标地址被安全策略拦截") from exc
    return _addresses_from_answers(list(answers))


def validate_target(value: str, *, schemes: tuple[str, ...] = ("http", "https"), resolver=None) -> ValidatedTarget:
    try:
        parsed = urlsplit(value)
        scheme = parsed.scheme.lower()
        host = parsed.hostname
        port = parsed.port
    except (ValueError, UnicodeError) as exc:
        raise TargetBlockedError("目标地址被安全策略拦截") from exc
    if scheme not in schemes or not host or parsed.username or parsed.password or parsed.fragment:
        raise TargetBlockedError("目标地址被安全策略拦截")
    normalized = _normalize_host(host)
    if port is None:
        port = 443 if scheme in {"https", "wss"} else 80
    if port not in {80, 443} or (scheme in {"http", "ws"} and port not in {80, 443}):
        raise TargetBlockedError("目标地址被安全策略拦截")
    addresses = resolve_public_addresses(normalized, port, resolver=resolver)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"
    return ValidatedTarget(scheme=scheme, host=normalized, port=port, path=path, ip=addresses[0])


def validate_redirect(current_url: str, location: str, *, resolver=None) -> tuple[str, ValidatedTarget]:
    destination = urljoin(current_url, location)
    current = urlsplit(current_url)
    target = validate_target(destination, schemes=("http", "https"), resolver=resolver)
    if current.scheme.lower() == "https" and target.scheme != "https":
        raise TargetBlockedError("目标地址被安全策略拦截")
    return destination, target


class PinnedHTTPConnection(http.client.HTTPConnection):
    def __init__(self, target: ValidatedTarget, timeout: float = 7.0):
        super().__init__(target.host, target.port, timeout=timeout)
        self.target = target

    def connect(self) -> None:
        self.sock = socket.create_connection((self.target.ip, self.target.port), self.timeout)


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, target: ValidatedTarget, timeout: float = 7.0):
        super().__init__(target.host, target.port, timeout=timeout, context=ssl.create_default_context())
        self.target = target

    def connect(self) -> None:
        raw = socket.create_connection((self.target.ip, self.target.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.target.host)


def connection_for(target: ValidatedTarget, timeout: float = 7.0):
    return PinnedHTTPSConnection(target, timeout) if target.scheme == "https" else PinnedHTTPConnection(target, timeout)
