from app.domain.strategies import PriceBar, StockSeries, evaluate_stock_strategies


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
