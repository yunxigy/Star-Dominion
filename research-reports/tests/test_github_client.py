from pathlib import Path

import httpx
import pytest

from research_reports.collector.github import GitHubClient, GitHubUnavailable
from research_reports.collector.types import NotModified


FIXTURE = Path(__file__).parent / "fixtures" / "trending_weekly.html"


def test_fetch_category_uses_weekly_url_and_user_agent() -> None:
    requested: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request)
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        rows = GitHubClient(http=http).fetch_trending("python")
    finally:
        http.close()

    assert rows[0].category == "python"
    assert requested[0].url.path == "/trending/python"
    assert requested[0].url.params["since"] == "weekly"
    assert requested[0].headers["User-Agent"] == "dream-chaser-research-reports/0.1"


def test_fetch_trending_retries_rate_limit_then_succeeds() -> None:
    attempts = 0
    sleeps: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        rows = GitHubClient(http=http, sleeper=sleeps.append).fetch_trending("all")
    finally:
        http.close()

    assert len(rows) == 2
    assert attempts == 2
    assert sleeps == [0.5]


def test_fetch_trending_decodes_github_html_as_utf8_without_charset() -> None:
    html = """
    <article class="Box-row">
      <h2><a href="/owner/utf8-repo">owner / utf8-repo</a></h2>
      <p class="col-9">Open source — built with care 💖</p>
      <span itemprop="programmingLanguage">Python</span>
      <a href="/owner/utf8-repo/stargazers">1,234</a>
      <a href="/owner/utf8-repo/forks">56</a>
      <span class="float-sm-right">789 stars this week</span>
    </article>
    """

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=html.encode("utf-8"),
            headers={"Content-Type": "text/html"},
        )

    http = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        rows = GitHubClient(http=http).fetch_trending("python")
    finally:
        http.close()

    assert rows[0].description == "Open source — built with care 💖"


def test_fetch_metadata_supports_etag_and_not_modified() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.headers.get("If-None-Match"):
            return httpx.Response(304, headers={"ETag": '"same"'})
        return httpx.Response(
            200,
            headers={"ETag": '"new"'},
            json={
                "full_name": "owner/alpha",
                "description": "metadata description",
                "language": "Python",
                "topics": ["agents", "tools"],
                "license": {"spdx_id": "MIT"},
                "default_branch": "main",
                "archived": False,
                "stargazers_count": 1500,
                "forks_count": 90,
                "updated_at": "2026-07-31T10:00:00Z",
            },
        )

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GitHubClient(http=http, token="private-token")
    try:
        metadata = client.fetch_metadata("owner/alpha", etag=None)
        unchanged = client.fetch_metadata("owner/alpha", etag='"same"')
    finally:
        http.close()

    assert metadata.license_spdx == "MIT"
    assert metadata.topics == ("agents", "tools")
    assert metadata.etag == '"new"'
    assert isinstance(unchanged, NotModified)
    assert requests[0].headers["Authorization"] == "Bearer private-token"
    assert requests[1].headers["If-None-Match"] == '"same"'


def test_errors_and_repr_do_not_expose_token() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="upstream failed")

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = GitHubClient(http=http, token="private-token", sleeper=lambda _: None)
    try:
        with pytest.raises(GitHubUnavailable) as caught:
            client.fetch_trending("rust")
    finally:
        http.close()

    assert "private-token" not in repr(client)
    assert "private-token" not in str(caught.value)


def test_rejects_unknown_category() -> None:
    http = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200)))
    try:
        with pytest.raises(ValueError, match="Unsupported category"):
            GitHubClient(http=http).fetch_trending("java")
    finally:
        http.close()
