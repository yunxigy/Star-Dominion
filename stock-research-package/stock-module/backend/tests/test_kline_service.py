from datetime import UTC, date, datetime, timedelta

import pytest

from app.domain.market_data import KlineUnavailable, RawKlineBar
from app.domain.stocks import InvalidMainBoardSymbol
from app.repositories.kline_cache import KlineRepository
from app.services.kline import KlineService
from app.services.stock_directory import InMemoryStockDirectory, StockRecord


class FakeSource:
    def __init__(
        self,
        bars: list[RawKlineBar] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.bars = bars or []
        self.error = error
        self.calls: list[tuple[str, int]] = []

    def load(self, symbol: str, minimum_bars: int) -> list[RawKlineBar]:
        self.calls.append((symbol, minimum_bars))
        if self.error is not None:
            raise self.error
        return self.bars


def make_bars(count: int = 160) -> list[RawKlineBar]:
    first = date(2026, 1, 1)
    return [
        RawKlineBar(
            date=first + timedelta(days=index),
            open=10 + index,
            high=11 + index,
            low=9 + index,
            close=10.5 + index,
            volume=1_000 + index,
            change_pct=None,
        )
        for index in range(count)
    ]


def make_service(
    tmp_path,
    *,
    now: datetime,
    source: FakeSource,
    directory=None,
) -> KlineService:
    return KlineService(
        KlineRepository(tmp_path / "hub.db"),
        source,
        directory=directory,
        clock=lambda: now,
    )


def test_service_calculates_ma_from_presliced_bars_and_latest_values(tmp_path) -> None:
    now = datetime(2026, 7, 27, 10, 0, tzinfo=UTC)
    bars = make_bars()
    source = FakeSource(bars)
    directory = InMemoryStockDirectory([StockRecord(symbol="600519", name="贵州茅台")])
    service = make_service(tmp_path, now=now, source=source, directory=directory)

    result = service.get("sh600519", days=20)

    closes = [bar.close for bar in bars]
    assert source.calls == [("600519", 140)]
    assert result.symbol == "600519"
    assert result.name == "贵州茅台"
    assert result.exchange == "SSE"
    assert result.days == 20
    assert len(result.bars) == 20
    assert result.bars[0].ma20 == pytest.approx(sum(closes[-39:-19]) / 20)
    assert result.bars[-1].ma5 == pytest.approx(sum(closes[-5:]) / 5)
    assert result.bars[-1].ma10 == pytest.approx(sum(closes[-10:]) / 10)
    assert result.bars[-1].ma20 == pytest.approx(sum(closes[-20:]) / 20)
    assert result.latest.trade_date == bars[-1].date
    assert result.latest.price == bars[-1].close
    assert result.latest.change == pytest.approx(closes[-1] - closes[-2])
    assert result.latest.change_pct == pytest.approx(
        (closes[-1] - closes[-2]) / closes[-2] * 100
    )
    assert result.generated_at == now
    assert result.stale is False


@pytest.mark.parametrize("days", [20, 60, 120])
def test_service_accepts_supported_periods_and_returns_requested_tail(tmp_path, days) -> None:
    source = FakeSource(make_bars())
    service = make_service(
        tmp_path,
        now=datetime(2026, 7, 27, 10, 0, tzinfo=UTC),
        source=source,
    )

    result = service.get("000001", days=days)

    assert result.days == days
    assert len(result.bars) == days
    assert result.name == "000001"
    assert result.exchange == "SZSE"


def test_service_rejects_an_unsupported_period_before_loading(tmp_path) -> None:
    source = FakeSource(make_bars())
    service = make_service(
        tmp_path,
        now=datetime(2026, 7, 27, 10, 0, tzinfo=UTC),
        source=source,
    )

    with pytest.raises(ValueError, match="20、60 或 120"):
        service.get("600519", days=30)

    assert source.calls == []


def test_service_propagates_invalid_main_board_symbol_before_loading(tmp_path) -> None:
    source = FakeSource(make_bars())
    service = make_service(
        tmp_path,
        now=datetime(2026, 7, 27, 10, 0, tzinfo=UTC),
        source=source,
    )

    with pytest.raises(InvalidMainBoardSymbol):
        service.get("300750", days=20)

    assert source.calls == []


def test_service_uses_cache_for_five_minutes_during_shanghai_trading_hours(tmp_path) -> None:
    now = datetime(2026, 7, 27, 10, 0, tzinfo=UTC)  # 18:00 in Shanghai, off hours
    trading_now = datetime(2026, 7, 27, 2, 0, tzinfo=UTC)  # 10:00 in Shanghai
    repository = KlineRepository(tmp_path / "hub.db")
    repository.save("600519", make_bars(), trading_now - timedelta(minutes=4, seconds=59))
    source = FakeSource(error=KlineUnavailable("should not load"))
    service = KlineService(repository, source, clock=lambda: trading_now)

    result = service.get("600519", days=20)

    assert result.stale is False
    assert source.calls == []
    assert result.generated_at == trading_now - timedelta(minutes=4, seconds=59)

    expired_source = FakeSource(make_bars())
    expired_service = KlineService(
        repository,
        expired_source,
        clock=lambda: trading_now + timedelta(seconds=2),
    )
    expired_service.get("600519", days=20)
    assert expired_source.calls == [("600519", 140)]


def test_service_uses_cache_for_thirty_minutes_outside_trading_hours(tmp_path) -> None:
    now = datetime(2026, 7, 27, 10, 0, tzinfo=UTC)  # 18:00 in Shanghai
    repository = KlineRepository(tmp_path / "hub.db")
    repository.save("600519", make_bars(), now - timedelta(minutes=29, seconds=59))
    source = FakeSource(error=KlineUnavailable("should not load"))
    service = KlineService(repository, source, clock=lambda: now)

    result = service.get("600519", days=20)

    assert result.stale is False
    assert source.calls == []

    expired_source = FakeSource(make_bars())
    expired_service = KlineService(
        repository,
        expired_source,
        clock=lambda: now + timedelta(seconds=2),
    )
    expired_service.get("600519", days=20)
    assert expired_source.calls == [("600519", 140)]


def test_service_returns_stale_cache_for_up_to_fourteen_days_on_source_failure(tmp_path) -> None:
    now = datetime(2026, 7, 27, 10, 0, tzinfo=UTC)
    fetched_at = now - timedelta(days=14)
    repository = KlineRepository(tmp_path / "hub.db")
    repository.save("600519", make_bars(), fetched_at)
    source = FakeSource(error=KlineUnavailable("upstream unavailable"))
    service = KlineService(repository, source, clock=lambda: now)

    result = service.get("600519", days=60)

    assert source.calls == [("600519", 140)]
    assert result.stale is True
    assert result.generated_at == fetched_at
    assert len(result.bars) == 60


def test_service_refuses_cache_older_than_fourteen_days(tmp_path) -> None:
    now = datetime(2026, 7, 27, 10, 0, tzinfo=UTC)
    repository = KlineRepository(tmp_path / "hub.db")
    repository.save("600519", make_bars(), now - timedelta(days=14, seconds=1))
    source = FakeSource(error=KlineUnavailable("upstream unavailable"))
    service = KlineService(repository, source, clock=lambda: now)

    with pytest.raises(KlineUnavailable, match="upstream unavailable"):
        service.get("600519", days=20)


def test_service_raises_when_source_fails_without_cache(tmp_path) -> None:
    source = FakeSource(error=KlineUnavailable("upstream unavailable"))
    service = make_service(
        tmp_path,
        now=datetime(2026, 7, 27, 10, 0, tzinfo=UTC),
        source=source,
    )

    with pytest.raises(KlineUnavailable, match="upstream unavailable"):
        service.get("600519", days=20)


def test_service_falls_back_to_symbol_when_directory_has_no_exact_match(tmp_path) -> None:
    directory = InMemoryStockDirectory([StockRecord(symbol="600000", name="浦发银行")])
    service = make_service(
        tmp_path,
        now=datetime(2026, 7, 27, 10, 0, tzinfo=UTC),
        source=FakeSource(make_bars()),
        directory=directory,
    )

    result = service.get("600519", days=20)

    assert result.name == "600519"
