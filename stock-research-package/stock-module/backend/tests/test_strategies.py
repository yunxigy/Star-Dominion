from datetime import date, timedelta

from app.domain.strategies import (
    PriceBar,
    StockSeries,
    evaluate_small_cap_absorption,
    evaluate_stock_strategies,
)


def _bar(
    close: float,
    *,
    pct: float = 1.0,
    low: float | None = None,
    high: float | None = None,
    volume: float = 100.0,
) -> PriceBar:
    return PriceBar(
        open=close * 0.99,
        high=high if high is not None else close * 1.02,
        low=low if low is not None else close * 0.99,
        close=close,
        pct=pct,
        volume=volume,
    )


def test_three_consecutive_limit_ups_produce_dragon_signal() -> None:
    bars = [_bar(10 + index * 0.1) for index in range(12)]
    bars[-3:] = [
        _bar(12.0, pct=9.8),
        _bar(13.1, pct=9.7),
        _bar(14.4, pct=9.9),
    ]

    results = evaluate_stock_strategies(StockSeries(symbol="600001", name="示例股份", bars=bars))
    dragon = next(result for result in results if result.strategy_id == "dragon")

    assert dragon.matched is True
    assert dragon.score == 100
    assert dragon.reasons == ["情绪龙头：近 5 日出现至少 3 连板"]
    assert dragon.factors["max_consecutive_limit_ups"] == 3


def test_first_board_ma5_signal_keeps_explanatory_factors() -> None:
    closes = [10.0, 10.1, 10.2, 10.3, 10.4, 11.44, 11.78, 12.15, 12.5, 12.9, 13.2, 13.5, 13.8, 14.1, 14.4]
    bars = [_bar(value, pct=9.8 if index == 5 else 2.5, low=value * 0.995) for index, value in enumerate(closes)]

    results = evaluate_stock_strategies(StockSeries(symbol="002001", name="趋势股份", bars=bars))
    ma5 = next(result for result in results if result.strategy_id == "first_board_ma5")

    assert ma5.matched is True
    assert "首板后价格始终守住 MA5" in ma5.reasons
    assert ma5.factors["first_board_index"] == 5


def test_2b_signal_uses_support_before_the_false_break_window() -> None:
    bars = [_bar(10 + index * 0.1, volume=100) for index in range(157)]
    prior_support = min(bar.low for bar in bars[-20:])
    bars.extend(
        [
            _bar(25.4, low=prior_support * 0.99, high=30.0, volume=100),
            _bar(25.8, low=25.0, high=30.0, volume=110),
            _bar(26.2, low=25.6, high=26.8, volume=220),
        ]
    )

    results = evaluate_stock_strategies(StockSeries(symbol="601001", name="反转股份", bars=bars))
    signal = next(result for result in results if result.strategy_id == "two_b_reversal")

    assert signal.matched is True
    assert "近 3 日假跌破后有效收回支撑" in signal.reasons
    assert signal.factors["volume_confirmed"] is True


def test_st_and_non_main_board_stocks_are_rejected_before_evaluation() -> None:
    bars = [_bar(10 + index, pct=9.9) for index in range(12)]

    st_results = evaluate_stock_strategies(StockSeries(symbol="600001", name="ST 示例", bars=bars))
    other_board_results = evaluate_stock_strategies(StockSeries(symbol="300001", name="创业示例", bars=bars))

    assert all(result.matched is False for result in st_results)
    assert all("ST 股票不进入候选池" in result.risk_flags for result in st_results)
    assert all(result.matched is False for result in other_board_results)
    assert all("非 A 股主板" in result.risk_flags for result in other_board_results)


def test_small_cap_absorption_accepts_exact_two_times_volume_and_marks_first_day() -> None:
    result = evaluate_small_cap_absorption(
        _absorption_stock(volumes={-3: 200}, market_cap=9_999_999_999)
    )

    assert result.matched is True
    assert result.reasons[0] == "首日倍量"
    assert result.factors["volume_multiple"] == 2
    assert result.factors["first_volume_spike"] is True
    assert result.factors["trigger_date"] == "2026-08-27"


def test_small_cap_absorption_rejects_cap_boundary_non_main_board_and_stocks() -> None:
    cases = (
        ("000001", "平安银行", 10_000_000_000),
        ("300001", "创业板样本", 1_000_000_000),
        ("600001", "ST样本", 1_000_000_000),
        ("600002", "退市样本", 1_000_000_000),
    )

    for symbol, name, market_cap in cases:
        result = evaluate_small_cap_absorption(
            _absorption_stock(symbol=symbol, name=name, market_cap=market_cap, volumes={-3: 200})
        )
        assert result.matched is False


def test_small_cap_absorption_rejects_previous_spike_zero_baseline_and_short_history() -> None:
    previous_spike = {5: 100, 6: 100, 7: 100, 8: 100, 9: 100, 10: 200, -3: 200}
    assert not evaluate_small_cap_absorption(
        _absorption_stock(volumes=previous_spike)
    ).matched

    zero_baseline = {-8: 0, -7: 0, -6: 0, -5: 0, -4: 0, -3: 200, -2: 0, -1: 0}
    assert not evaluate_small_cap_absorption(
        _absorption_stock(volumes=zero_baseline)
    ).matched

    assert not evaluate_small_cap_absorption(
        _absorption_stock(volumes={-3: 200}, length=37)
    ).matched


def test_small_cap_absorption_uses_earliest_of_three_trade_days() -> None:
    result = evaluate_small_cap_absorption(
        _absorption_stock(volumes={-3: 200, -2: 300, -1: 100})
    )

    assert result.matched is True
    assert result.factors["trigger_date"] == "2026-08-27"


def test_small_cap_absorption_rejects_price_range_and_drawdown_over_limits() -> None:
    range_bars = _absorption_stock(volumes={-3: 200}).bars
    range_bars[5] = range_bars[5].model_copy(update={"close": 100.0})
    range_bars[34] = range_bars[34].model_copy(update={"close": 125.01})
    assert not evaluate_small_cap_absorption(
        StockSeries(symbol="600001", name="样本", market_cap=1_000_000_000, bars=range_bars)
    ).matched

    drawdown_bars = _absorption_stock(volumes={-3: 200}).bars
    peak = 120.0
    trough = peak * (1 - 0.1501)
    drawdown_bars[5] = drawdown_bars[5].model_copy(update={"close": peak})
    drawdown_bars[20] = drawdown_bars[20].model_copy(update={"close": trough})
    assert not evaluate_small_cap_absorption(
        StockSeries(symbol="600001", name="样本", market_cap=1_000_000_000, bars=drawdown_bars)
    ).matched


def test_small_cap_absorption_requires_dates_and_market_cap() -> None:
    missing_date = _absorption_stock(volumes={-3: 200}, missing_date=True)
    assert not evaluate_small_cap_absorption(missing_date).matched
    assert not evaluate_small_cap_absorption(
        _absorption_stock(volumes={-3: 200}, market_cap=None)
    ).matched


def _absorption_stock(
    *,
    symbol: str = "600001",
    name: str = "样本股份",
    market_cap: float | None = 1_000_000_000,
    length: int = 38,
    volumes: dict[int, float] | None = None,
    missing_date: bool = False,
) -> StockSeries:
    volume_values = [100.0] * length
    for index, value in (volumes or {}).items():
        volume_values[index] = value
    bars = [
        _absorption_bar(
            close=100.0,
            volume=volume_values[index],
            trade_date=None if missing_date else date(2026, 7, 23) + timedelta(days=index),
        )
        for index in range(length)
    ]
    return StockSeries(symbol=symbol, name=name, market_cap=market_cap, bars=bars)


def _absorption_bar(*, close: float, volume: float, trade_date: date | None) -> PriceBar:
    return PriceBar(
        date=trade_date,
        open=close,
        high=close,
        low=close,
        close=close,
        pct=0.0,
        volume=volume,
    )
