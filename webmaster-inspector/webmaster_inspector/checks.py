from __future__ import annotations

import base64
import hashlib
import http.client
import os
import socket
import ssl
import time
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urlsplit

from .policy import TargetBlockedError, ValidatedTarget, connection_for, resolve_public_addresses, validate_redirect, validate_target

MAX_HEADERS = 50
MAX_HEADER_BYTES = 8 * 1024
MAX_BODY_BYTES = 128 * 1024


def _elapsed(start: float) -> int:
    return max(0, round((time.monotonic() - start) * 1000))


def _bounded_headers(response: http.client.HTTPResponse) -> dict[str, str]:
    values: dict[str, str] = {}
    total = 0
    for key, value in response.getheaders():
        key = key.lower()
        encoded = f"{key}: {value}".encode("utf-8", "ignore")
        if len(values) >= MAX_HEADERS or total + len(encoded) > MAX_HEADER_BYTES:
            break
        values[key] = value[:2048]
        total += len(encoded)
    return values


def check_http(url: str, policy: Callable[..., ValidatedTarget] | None = None) -> dict:
    policy = policy or validate_target
    start = time.monotonic()
    current_url = str(url)
    redirects: list[str] = []
    addresses: list[str] = []
    for redirect_count in range(4):
        target = policy(current_url)
        addresses = [target.ip]
        connection = connection_for(target, timeout=7.0)
        try:
            connection.request("HEAD", target.path_query, headers={"Host": target.host, "Accept": "*/*", "Connection": "close"})
            response = connection.getresponse()
            method = "HEAD"
            if response.status in {405, 501}:
                connection.close()
                connection = connection_for(target, timeout=7.0)
                connection.request("GET", target.path_query, headers={"Host": target.host, "Accept": "*/*", "Range": "bytes=0-0", "Connection": "close"})
                response = connection.getresponse()
                method = "GET"
            headers = _bounded_headers(response)
            status = response.status
            location = headers.get("location")
            # Read at most zero bytes for HEAD and a bounded prefix for GET, then close.
            if method == "GET":
                response.read(MAX_BODY_BYTES)
            if status in {301, 302, 303, 307, 308} and location:
                if redirect_count >= 3:
                    raise TargetBlockedError("目标地址被安全策略拦截")
                current_url, _ = validate_redirect(current_url, location)
                redirects.append(current_url)
                continue
            return {"status": status, "elapsed_ms": _elapsed(start), "resolved_addresses": addresses, "headers": headers, "redirect_chain": redirects}
        finally:
            connection.close()
    raise TargetBlockedError("目标地址被安全策略拦截")


def check_dns(hostname: str, resolver=None) -> dict:
    start = time.monotonic()
    values = resolve_public_addresses(hostname, 443, resolver=resolver)
    return {"hostname": hostname.lower().rstrip("."), "addresses": values, "elapsed_ms": _elapsed(start)}


def _name_from_cert(value) -> str | None:
    if not value:
        return None
    pieces: list[str] = []
    for section in value:
        for key, item in section:
            pieces.append(f"{key}={item}")
    return ", ".join(pieces) or None


def check_ssl(hostname: str, policy: Callable[..., ValidatedTarget] | None = None) -> dict:
    start = time.monotonic()
    policy = policy or validate_target
    target = policy(f"https://{hostname}:443")
    context = ssl.create_default_context()
    raw = socket.create_connection((target.ip, 443), timeout=7.0)
    try:
        with context.wrap_socket(raw, server_hostname=target.host) as wrapped:
            cert = wrapped.getpeercert() or {}
            san = cert.get("subjectAltName", ())
            return {
                "hostname": target.host,
                "port": 443,
                "protocol": wrapped.version() or "unknown",
                "cipher": (wrapped.cipher() or (None,))[0],
                "subject": _name_from_cert(cert.get("subject")),
                "issuer": _name_from_cert(cert.get("issuer")),
                "not_before": cert.get("notBefore"),
                "not_after": cert.get("notAfter"),
                "san_count": len(san),
                "elapsed_ms": _elapsed(start),
                "resolved_addresses": [target.ip],
            }
    finally:
        try:
            raw.close()
        except Exception:
            pass


def _read_handshake(sock: socket.socket, limit: int = 16 * 1024) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while total < limit:
        chunk = sock.recv(min(4096, limit - total))
        if not chunk:
            break
        chunks.append(chunk); total += len(chunk)
        if b"\r\n\r\n" in chunk or b"\n\n" in b"".join(chunks):
            break
    return b"".join(chunks)


def check_websocket(url: str, policy: Callable[..., ValidatedTarget] | None = None) -> dict:
    start = time.monotonic()
    policy = policy or validate_target
    target = policy(url, schemes=("ws", "wss"))
    raw = socket.create_connection((target.ip, target.port), timeout=7.0)
    sock = raw
    try:
        if target.scheme == "wss":
            sock = ssl.create_default_context().wrap_socket(raw, server_hostname=target.host)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {target.path_query} HTTP/1.1\r\nHost: {target.host}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode("ascii")
        sock.sendall(request)
        response = _read_handshake(sock)
        first_line = response.split(b"\r\n", 1)[0].decode("latin-1", "replace")
        accept = ""
        for line in response.decode("latin-1", "replace").splitlines():
            if line.lower().startswith("sec-websocket-accept:"):
                accept = line.split(":", 1)[1].strip()
        expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")).digest()).decode("ascii")
        ok = first_line.startswith("HTTP/") and " 101 " in f"{first_line} " and accept == expected
        return {"status": "101 Switching Protocols" if ok else first_line or "握手失败", "handshake_ok": ok, "elapsed_ms": _elapsed(start), "resolved_addresses": [target.ip], "detail": None if ok else "WebSocket 握手未通过"}
    finally:
        try: sock.close()
        except Exception: pass
