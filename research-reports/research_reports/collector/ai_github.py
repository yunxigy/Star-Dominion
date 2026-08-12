"""Build an AI-focused catalog from public GitHub Trending rows."""

from __future__ import annotations

from collections.abc import Iterable

from ..collector.types import TrendingRepository
from ..services.ai_catalog import AICategoryMatch, classify_repository


def classify_trending_rows(
    rows: Iterable[TrendingRepository],
) -> dict[str, list[tuple[TrendingRepository, AICategoryMatch]]]:
    result: dict[str, list[tuple[TrendingRepository, AICategoryMatch]]] = {}
    seen: set[str] = set()
    for row in rows:
        if row.full_name.lower() in seen:
            continue
        seen.add(row.full_name.lower())
        match = classify_repository(
            name=row.full_name,
            description=row.description,
            topics=(),
        )
        if match.primary_category == "other":
            continue
        for category in match.categories:
            result.setdefault(category, []).append((row, match))
    for category, entries in result.items():
        entries.sort(key=lambda entry: (-entry[1].score, entry[0].rank, entry[0].full_name))
    return result
