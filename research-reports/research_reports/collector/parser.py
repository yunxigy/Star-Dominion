"""Strict parser for GitHub's weekly Trending HTML."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Tag

from .types import TrendingRepository


class TrendingParseError(ValueError):
    pass


def _parse_count(text: str | None) -> int:
    if not text:
        return 0
    match = re.search(r"([0-9][0-9,]*)", text)
    return int(match.group(1).replace(",", "")) if match else 0


def _text(node: Tag | None) -> str | None:
    if node is None:
        return None
    value = " ".join(node.get_text(" ", strip=True).split())
    return value or None


def _repo_name(row: Tag) -> str | None:
    anchor = row.select_one("h2 a[href]")
    if not isinstance(anchor, Tag):
        return None
    path = str(anchor.get("href", "")).strip("/")
    parts = [part.strip() for part in path.split("/") if part.strip()]
    if len(parts) != 2:
        return None
    return f"{parts[0]}/{parts[1]}"


def _count_from_link(row: Tag, suffix: str) -> int:
    link = row.select_one(f'a[href$="/{suffix}"]')
    return _parse_count(_text(link if isinstance(link, Tag) else None))


def parse_trending(html: str, *, category: str) -> list[TrendingRepository]:
    soup = BeautifulSoup(html, "html.parser")
    parsed: list[TrendingRepository] = []
    for row in soup.select("article.Box-row"):
        if not isinstance(row, Tag):
            continue
        full_name = _repo_name(row)
        if full_name is None:
            continue
        weekly = next(
            (
                candidate
                for candidate in row.select("span")
                if "stars this week" in candidate.get_text(" ", strip=True).lower()
            ),
            None,
        )
        contributors = tuple(
            str(image.get("src"))
            for image in row.select('a[data-hovercard-type="user"] img[src]')
            if image.get("src")
        )
        description_node = row.select_one("p.col-9") or row.select_one("p.color-fg-muted")
        language_node = row.select_one('[itemprop="programmingLanguage"]')
        parsed.append(
            TrendingRepository(
                category=category,
                rank=len(parsed) + 1,
                full_name=full_name,
                description=_text(description_node if isinstance(description_node, Tag) else None),
                primary_language=_text(language_node if isinstance(language_node, Tag) else None),
                stars_total=_count_from_link(row, "stargazers"),
                forks_total=_count_from_link(row, "forks"),
                stars_since_weekly=_parse_count(_text(weekly)),
                contributor_urls=contributors,
                html_url=f"https://github.com/{full_name}",
            )
        )
    if not parsed:
        raise TrendingParseError("no repository rows found in GitHub Trending response")
    return parsed
