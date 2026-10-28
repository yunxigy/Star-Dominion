"""Stable wire contract for the unified site-auth service."""

from __future__ import annotations

SESSION_COOKIE = "sd_session"
CSRF_COOKIE = "sd_csrf"
FORWARDED_ORIGIN_HEADER = "X-Site-Request-Origin"
FORWARDED_CSRF_HEADER = "X-Site-CSRF"
SERVICE_KEY_HEADER = "X-Site-Service-Key"
REQUEST_METHOD_HEADER = "X-Site-Request-Method"
BROWSER_ORIGIN_HEADER = "Origin"
BROWSER_CSRF_HEADER = "X-CSRF-Token"


def build_forwarded_context(
    *,
    origin: str | None = None,
    csrf: str | None = None,
    session: str | None = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """Build only the optional forwarded headers and cookies.

    Service-specific headers (service key and request method) are deliberately
    left to each client so the contract stays useful for both sync and async
    adapters without hiding authorization policy.
    """

    headers: dict[str, str] = {}
    cookies: dict[str, str] = {}
    if origin:
        headers[FORWARDED_ORIGIN_HEADER] = origin
    if csrf:
        headers[FORWARDED_CSRF_HEADER] = csrf
        cookies[CSRF_COOKIE] = csrf
    if session:
        cookies[SESSION_COOKIE] = session
    return headers, cookies
