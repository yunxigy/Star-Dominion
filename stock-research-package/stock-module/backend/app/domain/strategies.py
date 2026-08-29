"""Pure, explainable implementations of the user's stock-selection rules."""

from datetime import UTC, date as date_type, datetime

from pydantic import BaseModel, Field

from app.domain.stocks import InvalidMainBoardSymbol, normalize_symbol


class PriceBar(BaseModel):
    open: float
    high: float
    low: float
    close: float
    pct: float
    volume: float
    date: date_type | None = None


class StockSeries(BaseModel):
    symbol: str
    name: str
    bars: list[PriceBar]
    concepts: list[str] = Field(default_factory=list)
    market_cap: float | None = None


class StrategyResult(BaseModel):
    strategy_id: str
    strategy_name: str
    matched: bool
    score: float
    reasons: list[str] = Field(default_factory=list)
    factors: dict[str, float | int | bool | str] = Field(default_factory=dict)
    risk_flags: list[str] = Field(default_factory=list)
    evaluated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


_STRATEGIES = (
    ("two_b_reversal", "2B 法则反转"),
    ("first_board_ma5", "首板沿 5 日线"),
    ("dragon", "龙头识别"),
)

SMALL_CAP_MARKET_CAP_LIMIT = 10_000_000_000


def evaluate_stock_strategies(stock: StockSeries) -> list[StrategyResult]:
    """Evaluate every rule and retain explanations for both matches and rejections."""
    try:
        normalize_symbol(stock.symbol)
    except InvalidMainBoardSymbol:
        return _blocked_results("非 A 股主板")
    if "ST" in stock.name.upper() or "退" in stock.name:
        return _blocked_results("ST 股票不进入候选池")

    return [_evaluate_2b(stock.bars), _evaluate_ma5(stock.bars), _evaluate_dragon(stock.bars)]


def evaluate_small_cap_absorption(stock: StockSeries) -> StrategyResult:
    """Find the earliest recent two-times-volume day after a stable 30-day base."""
    result = StrategyResult(
        strategy_id="small_cap_absorption",
        strategy_name="小市值倍量吸筹",
        matched=False,
        score=0,
    )
    try:
        normalize_symbol(stock.symbol)
    except InvalidMainBoardSymbol:
        result.risk_flags.append("非 A 股主板")
        return result
    if "ST" in stock.name.upper() or "退" in stock.name:
        result.risk_flags.append("ST 股票不进入候选池")
        return result
    if stock.market_cap is None:
        result.risk_flags.append("缺少总市值")
        return result
    if stock.market_cap >= SMALL_CAP_MARKET_CAP_LIMIT:
        result.risk_flags.append("总市值不低于 100 亿元")
        return result
    if len(stock.bars) < 38:
        result.risk_flags.append("K 线少于 38 个交易日")
        return result

    for index in range(len(stock.bars) - 3, len(stock.bars)):
        window_start = index - 30
        baseline_start = index - 5
        if any(bar.date is None for bar in stock.bars[window_start : index + 1]):
            result.risk_flags.append("倍量吸筹策略缺少交易日期")
            return result

        baseline_volume = sum(bar.volume for bar in stock.bars[baseline_start:index]) / 5
        if baseline_volume <= 0:
            continue
        volume_multiple = stock.bars[index].volume / baseline_volume
        if volume_multiple < 2:
            continue

        previous_spike = False
        for previous_index in range(window_start, index):
            previous_baseline = sum(
                bar.volume for bar in stock.bars[previous_index - 5 : previous_index]
            ) / 5
            if previous_baseline > 0 and stock.bars[previous_index].volume >= previous_baseline * 2:
                previous_spike = True
                break
        if previous_spike:
            continue

        closes = [bar.close for bar in stock.bars[window_start:index]]
        if any(close <= 0 for close in closes):
            continue
        minimum_close = min(closes)
        price_range_pct = (max(closes) - minimum_close) / minimum_close * 100
        peak = closes[0]
        max_drawdown_pct = 0.0
        for close in closes:
            peak = max(peak, close)
            max_drawdown_pct = max(max_drawdown_pct, (peak - close) / peak * 100)
        if price_range_pct > 25 or max_drawdown_pct > 15:
            continue

        result.matched = True
        result.reasons = [
            "首日倍量",
            "前 30 个交易日无其他倍量",
            "放量前 30 日价格波动与回撤受控",
        ]
        result.factors = {
            "market_cap_yuan": round(float(stock.market_cap), 2),
            "trigger_date": stock.bars[index].date.isoformat(),
            "volume_multiple": round(volume_multiple, 4),
            "price_range_pct": round(price_range_pct, 4),
            "max_drawdown_pct": round(max_drawdown_pct, 4),
            "first_volume_spike": True,
        }
        return result

    return result


def _blocked_results(reason: str) -> list[StrategyResult]:
    return [
        StrategyResult(
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            matched=False,
            score=0,
            risk_flags=[reason],
        )
        for strategy_id, strategy_name in _STRATEGIES
    ]


def _evaluate_2b(bars: list[PriceBar]) -> StrategyResult:
    result = StrategyResult(strategy_id="two_b_reversal", strategy_name="2B 法则反转", matched=False, score=0)
    if len(bars) < 150:
        result.risk_flags.append("K 线少于 150 个交易日")
        return result

    closes = [bar.close for bar in bars]
    ema21 = _ema(closes, 21)[-1]
    ema55 = _ema(closes, 55)[-1]
    ema144 = _ema(closes, 144)[-1]
    trend_aligned = ema21 > ema55 > ema144

    # The support is frozen before the three-day false-break window. Including
    # the false-break bars in the support calculation makes the rule impossible.
    support = min(bar.low for bar in bars[-23:-3])
    false_break = any(bar.low < support * 0.995 for bar in bars[-3:])
    recovered = bars[-1].close > support * 1.005
    resistance = max(bar.high for bar in bars[-13:-1])
    upside_room = (resistance - bars[-1].close) / bars[-1].close
    volume_confirmed = bars[-1].volume > bars[-2].volume
    matched = trend_aligned and false_break and recovered and upside_room >= 0.04 and volume_confirmed

    result.matched = matched
    result.score = 90 if matched else 0
    result.factors = {
        "ema21": round(ema21, 4),
        "ema55": round(ema55, 4),
        "ema144": round(ema144, 4),
        "support": round(support, 4),
        "upside_room": round(upside_room, 4),
        "volume_confirmed": volume_confirmed,
    }
    if matched:
        result.reasons = ["EMA21、EMA55、EMA144 多头排列", "近 3 日假跌破后有效收回支撑", "放量且上方空间不少于 4%"]
    return result


def _evaluate_ma5(bars: list[PriceBar]) -> StrategyResult:
    result = StrategyResult(strategy_id="first_board_ma5", strategy_name="首板沿 5 日线", matched=False, score=0)
    if len(bars) < 15:
        result.risk_flags.append("K 线少于 15 个交易日")
        return result

    ma5 = _moving_average([bar.close for bar in bars], 5)
    ma5_rising = ma5[-1] is not None and ma5[-2] is not None and ma5[-1] >= ma5[-2]
    price_above_ma5 = ma5[-1] is not None and bars[-1].close >= ma5[-1]
    first_board_index: int | None = None
    start = max(1, len(bars) - 10)
    for index in range(start, len(bars)):
        if bars[index].pct >= 9.5 and bars[index - 1].pct < 9.5:
            first_board_index = index
            break

    held_ma5 = False
    moves_valid = False
    if first_board_index is not None and first_board_index < len(bars) - 1:
        following = range(first_board_index + 1, len(bars))
        held_ma5 = all(ma5[index] is not None and bars[index].low >= float(ma5[index]) * 0.985 for index in following)
        moves_valid = all(-4.0 <= bars[index].pct <= 8.0 for index in following)

    matched = bool(first_board_index is not None and price_above_ma5 and ma5_rising and held_ma5 and moves_valid)
    result.matched = matched
    result.score = 85 if matched else 0
    result.factors = {
        "first_board_index": first_board_index if first_board_index is not None else -1,
        "ma5": round(float(ma5[-1]), 4) if ma5[-1] is not None else 0.0,
        "ma5_rising": ma5_rising,
        "held_ma5": held_ma5,
    }
    if matched:
        result.reasons = ["近 10 日出现首板", "首板后价格始终守住 MA5", "MA5 上行且后续涨跌幅受控"]
    return result


def _evaluate_dragon(bars: list[PriceBar]) -> StrategyResult:
    result = StrategyResult(strategy_id="dragon", strategy_name="龙头识别", matched=False, score=0)
    if len(bars) < 10:
        result.risk_flags.append("K 线少于 10 个交易日")
        return result

    consecutive = 0
    maximum = 0
    for bar in bars[-5:]:
        if bar.pct >= 9.5:
            consecutive += 1
            maximum = max(maximum, consecutive)
        else:
            consecutive = 0

    rebound = bars[-1].pct >= 9.5 and bars[-2].pct < 5 and any(bar.pct >= 9.5 for bar in bars[-5:-2])
    ten_day_gain = bars[-1].close / bars[-10].close - 1 if bars[-10].close else 0.0
    ma5 = sum(bar.close for bar in bars[-5:]) / 5
    trend_dragon = ten_day_gain > 0.35 and bars[-1].close > ma5

    if maximum >= 3:
        result.matched = True
        result.score = 100
        result.reasons = ["情绪龙头：近 5 日出现至少 3 连板"]
    elif maximum == 2:
        result.matched = True
        result.score = 90
        result.reasons = ["连板情绪龙：近 5 日出现 2 连板"]
    elif rebound:
        result.matched = True
        result.score = 80
        result.reasons = ["反包或补涨龙：涨停后休整并再次涨停"]
    elif trend_dragon:
        result.matched = True
        result.score = 70
        result.reasons = ["趋势龙头：近 10 日涨幅超过 35% 且站上 MA5"]
    result.factors = {"max_consecutive_limit_ups": maximum, "ten_day_gain": round(ten_day_gain, 4)}
    return result


def _ema(values: list[float], span: int) -> list[float]:
    alpha = 2 / (span + 1)
    output = [values[0]]
    for value in values[1:]:
        output.append(alpha * value + (1 - alpha) * output[-1])
    return output


def _moving_average(values: list[float], window: int) -> list[float | None]:
    output: list[float | None] = []
    for index in range(len(values)):
        if index + 1 < window:
            output.append(None)
        else:
            output.append(sum(values[index - window + 1 : index + 1]) / window)
    return output
