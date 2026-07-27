from datetime import UTC, datetime

from app.domain.market_data import RawKlineBar
from app.repositories.kline_cache import KlineRepository


def test_repository_round_trips_bars_and_timezone_aware_timestamp(tmp_path) -> None:
    repository = KlineRepository(tmp_path / "hub.db")
    fetched_at = datetime(2026, 7, 27, 1, 30, tzinfo=UTC)
    bars = [
        RawKlineBar(
            date="2026-07-24",
            open=10,
            high=11,
            low=9.8,
            close=10.5,
            volume=1_000,
            change_pct=2,
        ),
        RawKlineBar(
            date="2026-07-25",
            open=10.5,
            high=11.2,
            low=10.2,
            close=11,
            volume=1_200,
            change_pct=4.76,
        ),
    ]

    repository.save("600519", bars, fetched_at)
    cached = repository.get("600519")

    assert cached is not None
    assert cached.fetched_at == fetched_at
    assert cached.fetched_at.tzinfo is not None
    assert cached.bars[-1].close == 11
    assert cached.bars[-1].date.isoformat() == "2026-07-25"


def test_repository_replaces_the_previous_symbol_snapshot(tmp_path) -> None:
    repository = KlineRepository(tmp_path / "hub.db")
    first = datetime(2026, 7, 26, tzinfo=UTC)
    second = datetime(2026, 7, 27, tzinfo=UTC)

    repository.save(
        "600519",
        [RawKlineBar(date="2026-07-24", open=10, high=11, low=9, close=10, volume=100)],
        first,
    )
    repository.save(
        "600519",
        [RawKlineBar(date="2026-07-25", open=11, high=12, low=10, close=11, volume=200)],
        second,
    )

    cached = repository.get("600519")

    assert cached is not None
    assert cached.fetched_at == second
    assert [bar.close for bar in cached.bars] == [11]


def test_repository_returns_none_for_an_unknown_symbol(tmp_path) -> None:
    repository = KlineRepository(tmp_path / "hub.db")

    assert repository.get("000001") is None
