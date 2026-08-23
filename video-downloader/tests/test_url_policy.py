from __future__ import annotations

from dataclasses import dataclass

import pytest

from video_downloader.errors import ServiceError
from video_downloader.url_policy import PinnedHttpsRedirectTransport, UrlPolicy


PUBLIC_IP = "93.184.216.34"


class FakeResolver:
    def __init__(self, answers: dict[str, list[str]] | None = None) -> None:
        self.answers = answers or {}
        self.calls: list[str] = []

    def resolve(self, host: str) -> list[str]:
        self.calls.append(host)
        return self.answers.get(host, [PUBLIC_IP])


class FakeRedirectTransport:
    def __init__(self, redirects: dict[str, str] | None = None) -> None:
        self.redirects = redirects or {}
        self.calls: list[tuple[str, str]] = []

    def fetch_location(self, url: str, ip: str) -> str | None:
        self.calls.append((url, ip))
        return self.redirects.get(url)


def make_policy(settings, *, resolver=None, transport=None) -> UrlPolicy:
    return UrlPolicy(
        settings,
        resolver or FakeResolver(),
        transport or FakeRedirectTransport(),
    )


def test_extracts_one_supported_url_from_share_text_and_upgrades_http(settings):
    policy = make_policy(settings)

    result = policy.resolve("复制链接 http://v.douyin.com/abc/ 打开抖音")

    assert result.platform == "douyin"
    assert result.url == "https://v.douyin.com/abc/"


def test_strips_common_share_text_punctuation(settings):
    policy = make_policy(settings)

    result = policy.resolve("视频：https://www.bilibili.com/video/BV1demo）。")

    assert result.url == "https://www.bilibili.com/video/BV1demo"


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("没有链接", "INVALID_URL"),
        ("ftp://www.bilibili.com/video/BV1", "INVALID_URL"),
        ("https://example.com/video/1", "UNSUPPORTED_PLATFORM"),
        ("https://douyin.com.example.org/a", "UNSUPPORTED_PLATFORM"),
        ("https://user@www.bilibili.com/video/BV1", "INVALID_URL"),
        ("https://www.bilibili.com:8443/video/BV1", "INVALID_URL"),
        ("https://www.bilibili.com/video/BV1#reply", "INVALID_URL"),
        ("https://127.0.0.1/video/BV1", "INVALID_URL"),
        (
            "https://v.douyin.com/a https://www.bilibili.com/video/BV1",
            "MULTIPLE_URLS_NOT_SUPPORTED",
        ),
    ],
)
def test_rejects_invalid_input(settings, text, code):
    with pytest.raises(ServiceError) as caught:
        make_policy(settings).resolve(text)

    assert caught.value.code == code


@pytest.mark.parametrize(
    "addresses",
    [
        ["10.0.0.8"],
        ["127.0.0.1"],
        ["169.254.169.254"],
        ["::1"],
        [PUBLIC_IP, "192.168.1.20"],
    ],
)
def test_rejects_any_non_public_dns_answer(settings, addresses):
    resolver = FakeResolver({"b23.tv": addresses})

    with pytest.raises(ServiceError) as caught:
        make_policy(settings, resolver=resolver).resolve("https://b23.tv/private")

    assert caught.value.code == "INVALID_URL"


def test_validates_every_redirect_and_resolves_relative_locations(settings):
    start = "https://b23.tv/demo"
    middle = "https://www.bilibili.com/redirect/one"
    final = "https://www.bilibili.com/video/BV1demo"
    transport = FakeRedirectTransport(
        {
            start: middle,
            middle: "/video/BV1demo",
        }
    )
    resolver = FakeResolver()

    result = make_policy(settings, resolver=resolver, transport=transport).resolve(start)

    assert result.url == final
    assert result.platform == "bilibili"
    assert resolver.calls == ["b23.tv", "www.bilibili.com", "www.bilibili.com"]
    assert transport.calls == [
        (start, PUBLIC_IP),
        (middle, PUBLIC_IP),
        (final, PUBLIC_IP),
    ]


def test_rejects_redirect_outside_the_allowlist(settings):
    start = "https://b23.tv/demo"
    transport = FakeRedirectTransport({start: "https://localhost/admin"})

    with pytest.raises(ServiceError) as caught:
        make_policy(settings, transport=transport).resolve(start)

    assert caught.value.code == "INVALID_URL"


def test_rejects_a_fourth_redirect(settings):
    urls = [
        "https://b23.tv/zero",
        "https://b23.tv/one",
        "https://b23.tv/two",
        "https://b23.tv/three",
        "https://b23.tv/four",
    ]
    transport = FakeRedirectTransport(dict(zip(urls, urls[1:])))

    with pytest.raises(ServiceError) as caught:
        make_policy(settings, transport=transport).resolve(urls[0])

    assert caught.value.code == "INVALID_URL"
    assert len(transport.calls) == settings.max_redirects + 1


@dataclass
class FakeResponse:
    status: int
    location: str | None
    body: bytes = b""

    def getheader(self, name: str) -> str | None:
        assert name == "Location"
        return self.location

    def read(self, amount: int) -> bytes:
        return self.body[:amount]


class FakeConnection:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.requests: list[tuple[str, str, dict[str, str]]] = []
        self.closed = False

    def request(self, method: str, path: str, headers: dict[str, str]) -> None:
        self.requests.append((method, path, headers))

    def getresponse(self) -> FakeResponse:
        return self.responses.pop(0)

    def close(self) -> None:
        self.closed = True


def test_pinned_transport_connects_to_validated_ip_with_original_host_header():
    connection = FakeConnection([FakeResponse(302, "/video/BV1")])
    captured: list[tuple[str, str, float]] = []

    def factory(host: str, ip: str, timeout: float) -> FakeConnection:
        captured.append((host, ip, timeout))
        return connection

    transport = PinnedHttpsRedirectTransport(connection_factory=factory)

    location = transport.fetch_location(
        "https://www.bilibili.com/redirect?q=1",
        PUBLIC_IP,
    )

    assert location == "/video/BV1"
    assert captured == [("www.bilibili.com", PUBLIC_IP, 5.0)]
    assert connection.requests == [
        (
            "HEAD",
            "/redirect?q=1",
            {
                "Host": "www.bilibili.com",
                "User-Agent": "SD-Video-Resolver/1.0",
                "Accept": "*/*",
                "Connection": "close",
            },
        )
    ]
    assert connection.closed is True


def test_pinned_transport_falls_back_to_bounded_get_for_head_rejection():
    head = FakeConnection([FakeResponse(405, None)])
    get = FakeConnection([FakeResponse(200, None, b"x" * 2048)])
    connections = [head, get]
    transport = PinnedHttpsRedirectTransport(
        connection_factory=lambda host, ip, timeout: connections.pop(0)
    )

    assert transport.fetch_location("https://b23.tv/demo", PUBLIC_IP) is None
    assert get.requests[0][0] == "GET"
    assert get.requests[0][2]["Range"] == "bytes=0-0"
    assert head.closed is True
    assert get.closed is True
