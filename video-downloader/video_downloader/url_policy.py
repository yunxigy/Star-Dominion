from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import ssl
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol
from urllib.parse import SplitResult, urljoin, urlsplit, urlunsplit

from .config import VideoSettings
from .errors import ServiceError

Platform = Literal["douyin", "bilibili"]

_URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_TRAILING_PUNCTUATION = "。，、；！？)]}】）》,.!?;"
_ALLOWED_ROOTS: tuple[tuple[str, Platform], ...] = (
    ("douyin.com", "douyin"),
    ("iesdouyin.com", "douyin"),
    ("bilibili.com", "bilibili"),
    ("b23.tv", "bilibili"),
)


@dataclass(frozen=True)
class ResolvedVideoUrl:
    platform: Platform
    url: str


class DnsResolver(Protocol):
    def resolve(self, host: str) -> list[str]:
        raise NotImplementedError


class RedirectTransport(Protocol):
    def fetch_location(self, url: str, ip: str) -> str | None:
        raise NotImplementedError


class _Response(Protocol):
    status: int

    def getheader(self, name: str) -> str | None:
        raise NotImplementedError

    def read(self, amount: int) -> bytes:
        raise NotImplementedError


class _Connection(Protocol):
    def request(self, method: str, path: str, headers: dict[str, str]) -> None:
        raise NotImplementedError

    def getresponse(self) -> _Response:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError


class SocketDnsResolver:
    def resolve(self, host: str) -> list[str]:
        records = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        addresses: list[str] = []
        for record in records:
            address = record[4][0]
            if address not in addresses:
                addresses.append(address)
        return addresses


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, ip: str, timeout: float) -> None:
        super().__init__(
            host=host,
            port=443,
            timeout=timeout,
            context=ssl.create_default_context(),
        )
        self._pinned_ip = ip

    def connect(self) -> None:
        self.sock = self._create_connection(
            (self._pinned_ip, self.port),
            self.timeout,
            self.source_address,
        )
        if self._tunnel_host:
            self._tunnel()
        if self._context is None:
            raise OSError("TLS context is unavailable")
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def _default_connection_factory(host: str, ip: str, timeout: float) -> _Connection:
    return _PinnedHTTPSConnection(host, ip, timeout)


class PinnedHttpsRedirectTransport:
    def __init__(
        self,
        connection_factory: Callable[[str, str, float], _Connection] | None = None,
        timeout_seconds: float = 5.0,
    ) -> None:
        self._connection_factory = connection_factory or _default_connection_factory
        self._timeout_seconds = timeout_seconds

    def fetch_location(self, url: str, ip: str) -> str | None:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("redirect transport requires an HTTPS URL")

        response_status, location = self._request(parsed, ip, "HEAD")
        if response_status in {405, 501}:
            response_status, location = self._request(parsed, ip, "GET")
        if 300 <= response_status < 400:
            return location
        return None

    def _request(self, parsed: SplitResult, ip: str, method: str) -> tuple[int, str | None]:
        host = parsed.hostname
        if host is None:
            raise ValueError("URL host is required")
        target = parsed.path or "/"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        headers = {
            "Host": host,
            "User-Agent": "SD-Video-Resolver/1.0",
            "Accept": "*/*",
            "Connection": "close",
        }
        if method == "GET":
            headers["Range"] = "bytes=0-0"

        connection = self._connection_factory(host, ip, self._timeout_seconds)
        try:
            connection.request(method, target, headers=headers)
            response = connection.getresponse()
            location = response.getheader("Location")
            if method == "GET":
                response.read(1024)
            return response.status, location
        finally:
            connection.close()


class UrlPolicy:
    def __init__(
        self,
        settings: VideoSettings,
        resolver: DnsResolver,
        transport: RedirectTransport,
    ) -> None:
        self._settings = settings
        self._resolver = resolver
        self._transport = transport

    @classmethod
    def from_settings(cls, settings: VideoSettings) -> "UrlPolicy":
        return cls(settings, SocketDnsResolver(), PinnedHttpsRedirectTransport())

    def resolve(self, text: str) -> ResolvedVideoUrl:
        candidates = [match.group(0).rstrip(_TRAILING_PUNCTUATION) for match in _URL_PATTERN.finditer(text)]
        if not candidates:
            raise ServiceError("INVALID_URL", "请粘贴有效的视频链接。", 400)

        supported: list[ResolvedVideoUrl] = []
        saw_unsupported = False
        for candidate in candidates:
            parsed, host = self._parse_and_validate_structure(candidate)
            platform = self._platform_for_host(host)
            if platform is None:
                saw_unsupported = True
                continue
            supported.append(ResolvedVideoUrl(platform, self._canonical_url(parsed, host)))

        if len(supported) > 1:
            raise ServiceError(
                "MULTIPLE_URLS_NOT_SUPPORTED",
                "一次只能解析一个抖音或 B 站视频链接。",
                400,
            )
        if not supported:
            code = "UNSUPPORTED_PLATFORM" if saw_unsupported else "INVALID_URL"
            message = "目前只支持抖音和 B 站单个公开视频。" if saw_unsupported else "请粘贴有效的视频链接。"
            raise ServiceError(code, message, 400)

        return self._follow_redirects(supported[0])

    def _follow_redirects(self, initial: ResolvedVideoUrl) -> ResolvedVideoUrl:
        current = initial.url
        redirects = 0
        while True:
            parsed, host = self._parse_and_validate_structure(current)
            platform = self._platform_for_host(host)
            if platform is None:
                raise ServiceError("INVALID_URL", "视频链接跳转到了不安全的地址。", 400)
            canonical = self._canonical_url(parsed, host)
            ip = self._validated_ip(host)
            try:
                location = self._transport.fetch_location(canonical, ip)
            except ServiceError:
                raise
            except (OSError, ValueError, http.client.HTTPException) as exc:
                raise ServiceError(
                    "EXTRACTOR_TEMPORARILY_UNAVAILABLE",
                    "暂时无法解析视频短链接，请稍后重试。",
                    502,
                    retryable=True,
                ) from exc
            if location is None:
                return ResolvedVideoUrl(platform, canonical)
            if redirects >= self._settings.max_redirects:
                raise ServiceError("INVALID_URL", "视频链接重定向次数过多。", 400)
            redirects += 1
            current = urljoin(canonical, location)

    def _validated_ip(self, host: str) -> str:
        try:
            addresses = self._resolver.resolve(host)
        except (OSError, socket.gaierror) as exc:
            raise ServiceError("INVALID_URL", "视频链接域名无法解析。", 400) from exc
        if not addresses:
            raise ServiceError("INVALID_URL", "视频链接域名无法解析。", 400)

        normalized: list[str] = []
        for address in addresses:
            try:
                parsed = ipaddress.ip_address(address)
            except ValueError as exc:
                raise ServiceError("INVALID_URL", "视频链接解析到了无效地址。", 400) from exc
            if not parsed.is_global:
                raise ServiceError("INVALID_URL", "视频链接解析到了不安全的地址。", 400)
            normalized.append(str(parsed))
        return normalized[0]

    @staticmethod
    def _parse_and_validate_structure(url: str) -> tuple[SplitResult, str]:
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except ValueError as exc:
            raise ServiceError("INVALID_URL", "视频链接格式不正确。", 400) from exc

        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            raise ServiceError("INVALID_URL", "视频链接格式不正确。", 400)
        if parsed.username is not None or parsed.password is not None:
            raise ServiceError("INVALID_URL", "视频链接不能包含用户信息。", 400)
        if port not in {None, 80, 443}:
            raise ServiceError("INVALID_URL", "视频链接包含不支持的端口。", 400)
        if parsed.fragment:
            raise ServiceError("INVALID_URL", "视频链接不能包含片段标识。", 400)

        if UrlPolicy._is_ip_literal(parsed.hostname):
            raise ServiceError("INVALID_URL", "视频链接不能使用 IP 地址。", 400)

        try:
            host = parsed.hostname.encode("idna").decode("ascii").lower().rstrip(".")
        except UnicodeError as exc:
            raise ServiceError("INVALID_URL", "视频链接域名格式不正确。", 400) from exc
        return parsed, host

    @staticmethod
    def _canonical_url(parsed: SplitResult, host: str) -> str:
        scheme = "https"
        path = parsed.path or "/"
        return urlunsplit((scheme, host, path, parsed.query, ""))

    @staticmethod
    def _platform_for_host(host: str) -> Platform | None:
        for root, platform in _ALLOWED_ROOTS:
            if host == root or host.endswith(f".{root}"):
                return platform
        return None

    @staticmethod
    def _is_ip_literal(host: str) -> bool:
        try:
            ipaddress.ip_address(host)
        except ValueError:
            return False
        return True
