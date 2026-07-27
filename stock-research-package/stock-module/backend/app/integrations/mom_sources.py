"""Real Eastmoney and Xiaohongshu sources for the Mom Index."""

import asyncio
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
import html as html_module
import re
from typing import Any, Literal

import httpx
from pydantic import BaseModel, HttpUrl

from app.domain.mom_index import MomSourceStatus


SECTORS = {
    "nasdaq": {"name": "纳斯达克", "guba": "of159941"},
    "gold": {"name": "黄金", "guba": "of518880"},
    "cpo": {"name": "CPO 通信", "guba": "of515880"},
    "semiconductor": {"name": "半导体", "guba": "of512480"},
}

DEFAULT_XHS_KEYWORDS = {
    "nasdaq": ["美股怎么买", "纳斯达克新手", "纳指还能买吗"],
    "gold": ["黄金怎么买", "黄金亏了", "黄金还能涨吗"],
    "cpo": ["CPO是什么", "CPO还能买吗", "通信ETF"],
    "semiconductor": ["芯片还能上车吗", "半导体新手", "芯片ETF"],
}


class MomCollectedPost(BaseModel):
    sector_id: Literal["nasdaq", "gold", "cpo", "semiconductor"]
    platform: Literal["eastmoney", "xiaohongshu"]
    platform_id: str
    title: str
    url: HttpUrl | None
    published_at: datetime | None
    collected_at: datetime


class SourceCollection(BaseModel):
    status: MomSourceStatus
    posts: list[MomCollectedPost]


def parse_eastmoney_posts(
    page: str,
    *,
    sector_id: str,
    collected_at: datetime,
) -> list[MomCollectedPost]:
    matches = re.findall(
        r'<a[^>]*href="(?P<path>/news,[^"]+)"[^>]*title="(?P<title>[^"]*)"',
        page,
        flags=re.IGNORECASE | re.DOTALL,
    )
    posts: list[MomCollectedPost] = []
    for path, raw_title in matches:
        title = html_module.unescape(raw_title).strip()
        if not title or title == "点击开始搜索":
            continue
        tail = path.removesuffix(".html").split(",")[-1]
        posts.append(
            MomCollectedPost(
                sector_id=sector_id,
                platform="eastmoney",
                platform_id=tail,
                title=title,
                url=f"https://guba.eastmoney.com{path}",
                published_at=None,
                collected_at=collected_at,
            )
        )
    return posts


class EastmoneyMomSource:
    def __init__(
        self,
        *,
        proxy: str | None = None,
        clock: Callable[[], datetime] | None = None,
        fetch: Callable[[str], str] | None = None,
    ) -> None:
        self._proxy = proxy
        self._clock = clock or (lambda: datetime.now(UTC))
        self._fetch = fetch

    def collect(self) -> SourceCollection:
        collected_at = self._clock()
        posts: list[MomCollectedPost] = []
        errors: list[str] = []
        for sector_id, config in SECTORS.items():
            url = f"https://guba.eastmoney.com/list,{config['guba']}.html"
            try:
                if self._fetch is not None:
                    page = self._fetch(url)
                else:
                    with httpx.Client(proxy=self._proxy, timeout=20, trust_env=False) as client:
                        response = client.get(
                            url,
                            headers={"User-Agent": "Mozilla/5.0 Chrome/124 Safari/537.36"},
                        )
                        response.raise_for_status()
                        page = response.text
                posts.extend(
                    parse_eastmoney_posts(
                        page,
                        sector_id=sector_id,
                        collected_at=collected_at,
                    )
                )
            except Exception as exc:
                errors.append(f"{config['name']}：{exc}")
        status = "ok" if posts else "error"
        return SourceCollection(
            status=MomSourceStatus(
                source_id="eastmoney",
                status=status,
                collected_at=collected_at,
                post_count=len(posts),
                message="；".join(errors) or None,
            ),
            posts=posts,
        )


def _items(payload: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    candidate: Any = payload
    for key in ("data", "result"):
        if isinstance(candidate, Mapping) and key in candidate:
            candidate = candidate[key]
    if isinstance(candidate, Mapping):
        candidate = candidate.get("items") or candidate.get("feeds") or candidate.get("notes") or []
    return [item for item in candidate if isinstance(item, Mapping)] if isinstance(candidate, list) else []


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


class XiaohongshuMomSource:
    def __init__(
        self,
        client,
        *,
        keywords: Mapping[str, list[str]] | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._client = client
        self._keywords = dict(keywords or DEFAULT_XHS_KEYWORDS)
        self._clock = clock or (lambda: datetime.now(UTC))

    async def _collect_async(self, collected_at: datetime) -> list[MomCollectedPost]:
        seen: set[str] = set()
        posts: list[MomCollectedPost] = []
        for sector_id, keywords in self._keywords.items():
            for keyword in keywords:
                payload = await self._client.call(
                    "xhs_search",
                    {
                        "keyword": keyword,
                        "filters": {"sort_by": "最新", "publish_time": "一天内"},
                    },
                )
                for raw in _items(payload):
                    platform_id = str(raw.get("id") or raw.get("note_id") or "").strip()
                    title = str(raw.get("title") or raw.get("display_title") or "").strip()
                    url = raw.get("url")
                    dedupe_key = platform_id or str(url) or title
                    if not dedupe_key or not title or dedupe_key in seen:
                        continue
                    seen.add(dedupe_key)
                    posts.append(
                        MomCollectedPost(
                            sector_id=sector_id,
                            platform="xiaohongshu",
                            platform_id=platform_id or dedupe_key,
                            title=title,
                            url=url,
                            published_at=_parse_time(raw.get("publish_time") or raw.get("published_at")),
                            collected_at=collected_at,
                        )
                    )
        return posts

    def collect(self) -> SourceCollection:
        collected_at = self._clock()
        try:
            posts = asyncio.run(self._collect_async(collected_at))
            status = "ok"
            message = None
        except Exception as exc:
            posts = []
            text = str(exc)
            lowered = text.lower()
            if "login" in lowered or "登录" in text:
                status = "login_required"
            elif "captcha" in lowered or "risk" in lowered or "风控" in text or "验证" in text:
                status = "risk_controlled"
            else:
                status = "error"
            message = text[:240]
        return SourceCollection(
            status=MomSourceStatus(
                source_id="xiaohongshu",
                status=status,
                collected_at=collected_at,
                post_count=len(posts),
                message=message,
            ),
            posts=posts,
        )
