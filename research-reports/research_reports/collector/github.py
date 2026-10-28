"""Resilient HTTP client for GitHub Trending and repository metadata."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
import time
from typing import Any
from urllib.parse import quote

import httpx

from .parser import parse_trending
from .types import NotModified, RepositoryMetadata, TrendingRepository


CATEGORIES = ("all", "python", "javascript", "typescript", "go", "rust")
_RETRY_DELAYS = (0.5, 1.0, 2.0)
_USER_AGENT = "dream-chaser-research-reports/0.1"


class GitHubUnavailable(ConnectionError):
    pass


class GitHubClient:
    def __init__(
        self,
        *,
        http: httpx.Client,
        token: str | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self._http = http
        self._token = token
        self._sleeper = sleeper

    def __repr__(self) -> str:
        return "GitHubClient(token_configured=%s)" % bool(self._token)

    def fetch_trending(self, category: str) -> list[TrendingRepository]:
        if category not in CATEGORIES:
            raise ValueError(f"Unsupported category: {category}")
        path = "/trending" if category == "all" else f"/trending/{category}"
        response = self._get_with_retry(
            f"https://github.com{path}",
            params={"since": "weekly"},
        )
        return parse_trending(response.text, category=category)

    def fetch_metadata(
        self,
        full_name: str,
        *,
        etag: str | None,
    ) -> RepositoryMetadata | NotModified:
        parts = full_name.split("/")
        if len(parts) != 2 or not all(parts):
            raise ValueError("full_name must contain owner/repository")
        headers = {"If-None-Match": etag} if etag else None
        encoded = "/".join(quote(part, safe="") for part in parts)
        response = self._get_with_retry(
            f"https://api.github.com/repos/{encoded}",
            headers=headers,
            allow_not_modified=True,
        )
        if response.status_code == 304:
            return NotModified(etag=response.headers.get("ETag") or etag)
        payload: dict[str, Any] = response.json()
        updated_at = payload.get("updated_at")
        license_data = payload.get("license")
        return RepositoryMetadata(
            full_name=str(payload.get("full_name") or full_name),
            description=_optional_text(payload.get("description")),
            primary_language=_optional_text(payload.get("language")),
            topics=tuple(str(topic) for topic in payload.get("topics") or []),
            license_spdx=(
                _optional_text(license_data.get("spdx_id"))
                if isinstance(license_data, dict)
                else None
            ),
            default_branch=_optional_text(payload.get("default_branch")),
            is_archived=bool(payload.get("archived", False)),
            stars_total=int(payload.get("stargazers_count") or 0),
            forks_total=int(payload.get("forks_count") or 0),
            github_updated_at=(
                datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))
                if updated_at
                else None
            ),
            etag=response.headers.get("ETag"),
        )

    def _get_with_retry(
        self,
        url: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        allow_not_modified: bool = False,
    ) -> httpx.Response:
        request_headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": _USER_AGENT,
        }
        if self._token:
            request_headers["Authorization"] = f"Bearer {self._token}"
        if headers:
            request_headers.update(headers)

        last_status: int | None = None
        for attempt in range(len(_RETRY_DELAYS) + 1):
            try:
                response = self._http.get(
                    url,
                    params=params,
                    headers=request_headers,
                    timeout=httpx.Timeout(20.0, connect=5.0),
                    follow_redirects=True,
                )
                last_status = response.status_code
                if 200 <= response.status_code < 300:
                    return response
                if allow_not_modified and response.status_code == 304:
                    return response
                retryable = response.status_code == 429 or response.status_code >= 500
                if not retryable:
                    raise GitHubUnavailable(
                        f"GitHub request rejected with HTTP {response.status_code}"
                    )
            except httpx.HTTPError as exc:
                if attempt >= len(_RETRY_DELAYS):
                    raise GitHubUnavailable("GitHub request failed after retries") from exc
            if attempt < len(_RETRY_DELAYS):
                self._sleeper(_RETRY_DELAYS[attempt])
        raise GitHubUnavailable(
            f"GitHub request failed after retries (last status {last_status})"
        )


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
