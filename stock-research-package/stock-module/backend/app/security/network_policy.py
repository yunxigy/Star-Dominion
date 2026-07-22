"""Network policy for user-supplied OpenAI-compatible endpoints."""

import ipaddress
import socket
from collections.abc import Callable, Iterable
from urllib.parse import urlsplit, urlunsplit


class UnsafeModelEndpoint(ValueError):
    """Raised when a model endpoint could reach a prohibited network target."""


AddressResolver = Callable[[str], Iterable[str]]


def resolve_host_addresses(host: str) -> list[str]:
    return sorted(
        {
            item[4][0]
            for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        }
    )


def validate_model_endpoint(
    url: str,
    *,
    production: bool,
    allow_private: bool,
    resolver: AddressResolver = resolve_host_addresses,
) -> str:
    parsed = urlsplit(url.strip())
    private_development = not production and allow_private
    allowed_schemes = {"https", "http"} if private_development else {"https"}
    if parsed.scheme.lower() not in allowed_schemes:
        raise UnsafeModelEndpoint("model endpoint must use HTTPS")
    if not parsed.hostname:
        raise UnsafeModelEndpoint("model endpoint requires a hostname")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeModelEndpoint("model endpoint cannot contain credentials")
    if parsed.fragment or parsed.query:
        raise UnsafeModelEndpoint("model endpoint cannot contain query parameters or fragments")
    try:
        addresses = list(resolver(parsed.hostname))
    except (OSError, socket.gaierror) as exc:
        raise UnsafeModelEndpoint("model endpoint hostname could not be resolved") from exc
    if not addresses:
        raise UnsafeModelEndpoint("model endpoint hostname resolved to no addresses")
    for value in addresses:
        try:
            address = ipaddress.ip_address(value)
        except ValueError as exc:
            raise UnsafeModelEndpoint("model endpoint resolved to an invalid address") from exc
        unsafe = (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        )
        if unsafe and not private_development:
            raise UnsafeModelEndpoint("model endpoint resolved to a non-public address")
    normalized = parsed._replace(scheme=parsed.scheme.lower())
    return urlunsplit(normalized).rstrip("/")
