"""Pure ranking signal calculations."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class EntryView:
    full_name: str
    rank: int
    stars_since_weekly: int
    status: str
    consecutive_weeks: int


@dataclass(frozen=True, slots=True)
class HourlyDelta:
    rank_change: int
    star_change: int


@dataclass(frozen=True, slots=True)
class RankingSummary:
    new_count: int
    continuing_count: int
    stars_since_weekly_total: int
    fastest_growth_full_name: str | None


def classify_status(
    full_name: str,
    *,
    current_rank: int,
    previous_rank: int | None,
    history: Mapping[str, Sequence[int]],
) -> str:
    if previous_rank is None:
        return "returned" if full_name in history else "new"
    if current_rank < previous_rank:
        return "rising"
    if current_rank > previous_rank:
        return "falling"
    return "steady"


def consecutive_weeks(presence_newest_first: Sequence[bool]) -> int:
    count = 0
    for present in presence_newest_first:
        if not present:
            break
        count += 1
    return count


def hourly_delta(
    *,
    current_rank: int,
    current_stars: int,
    previous_rank: int,
    previous_stars: int,
) -> HourlyDelta:
    return HourlyDelta(
        rank_change=previous_rank - current_rank,
        star_change=current_stars - previous_stars,
    )


def summarize(entries: Sequence[EntryView]) -> RankingSummary:
    fastest = min(
        entries,
        key=lambda entry: (-entry.stars_since_weekly, entry.rank),
        default=None,
    )
    return RankingSummary(
        new_count=sum(entry.status == "new" for entry in entries),
        continuing_count=sum(entry.consecutive_weeks > 1 for entry in entries),
        stars_since_weekly_total=sum(entry.stars_since_weekly for entry in entries),
        fastest_growth_full_name=fastest.full_name if fastest else None,
    )
