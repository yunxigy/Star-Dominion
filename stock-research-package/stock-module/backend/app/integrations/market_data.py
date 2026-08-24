"""Real Sina daily K-line loading and normalization."""

from collections.abc import Callable, Mapping
from datetime import UTC, date, datetime, timedelta
import importlib
import logging
import math
import time
from typing import Any
from zoneinfo import ZoneInfo

from app.domain.market_data import KlineUnavailable, RawKlineBar


LOGGER = logging.getLogger(__name__)
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")
DEFAULT_RETRY_DELAYS = (0.0, 0.25)


def _records(frame: Any) -> list[Mapping[str, Any]]:
    if frame is None:
        return []
    if getattr(frame, "empty", False):
        return []
    if hasattr(frame, "to_dict"):
        rows = frame.to_dict(orient="records")
    else:
        rows = list(frame)
    return [row for row in rows if isinstance(row, Mapping)]


def _finite_number(value: Any) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("non-finite number")
    return number


def _optional_finite_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return _finite_number(value)
    except (TypeError, ValueError):
        return None


def _first_value(row: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        if name in row:
            return row[name]
    return None


def _normalize_rows(rows: list[Mapping[str, Any]]) -> list[RawKlineBar]:
    bars_by_date: dict[date, RawKlineBar] = {}
    for row in rows:
        try:
            trade_date = date.fromisoformat(str(row["date"]).strip())
            bar = RawKlineBar(
                date=trade_date,
                open=_finite_number(row["open"]),
                high=_finite_number(row["high"]),
                low=_finite_number(row["low"]),
                close=_finite_number(row["close"]),
                volume=_finite_number(row["volume"]),
                change_pct=_optional_finite_number(row.get("change_pct")),
            )
        except (KeyError, TypeError, ValueError):
            continue
        bars_by_date[trade_date] = bar
    return [bars_by_date[trade_date] for trade_date in sorted(bars_by_date)]


def _normalize_sina_frame(frame: Any) -> list[RawKlineBar]:
    rows = [
        {
            "date": _first_value(row, "\u65e5\u671f", "date", "trade_date"),
            "open": _first_value(row, "\u5f00\u76d8", "open"),
            "high": _first_value(row, "\u6700\u9ad8", "high"),
            "low": _first_value(row, "\u6700\u4f4e", "low"),
            "close": _first_value(row, "\u6536\u76d8", "close"),
            "volume": _first_value(row, "\u6210\u4ea4\u91cf", "volume"),
            "change_pct": _first_value(
                row,
                "\u6da8\u8dcc\u5e45",
                "change_pct",
                "pct_chg",
            ),
        }
        for row in _records(frame)
    ]
    return _normalize_rows(rows)


class SinaKlineSource:
    """Load qfq daily bars from Sina through AKShare."""

    def __init__(
        self,
        akshare_module: Any | None = None,
        *,
        today: Callable[[], date] | None = None,
        sleep: Callable[[float], None] | None = None,
        retry_delays: tuple[float, ...] = DEFAULT_RETRY_DELAYS,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._akshare = akshare_module
        self._sleep = sleep or time.sleep
        self._retry_delays = tuple(retry_delays)
        self._now = now or (lambda: datetime.now(UTC))
        self._today = today or self._current_shanghai_date

    def _get_akshare(self) -> Any:
        if self._akshare is None:
            self._akshare = importlib.import_module("akshare")
        return self._akshare

    def _current_shanghai_date(self) -> date:
        current = self._now()
        if current.tzinfo is None:
            current = current.replace(tzinfo=UTC)
        return current.astimezone(SHANGHAI_TZ).date()

    def _load_with_retries(
        self,
        *,
        symbol: str,
        loader: Callable[[], list[RawKlineBar]],
    ) -> list[RawKlineBar]:
        attempts = 1 + len(self._retry_delays)
        for attempt in range(1, attempts + 1):
            try:
                bars = loader()
                if bars:
                    return bars
                LOGGER.warning(
                    "kline provider returned no bars: source=sina symbol=%s attempt=%d/%d",
                    symbol,
                    attempt,
                    attempts,
                )
            except Exception as exc:
                LOGGER.warning(
                    "kline provider failed: source=sina symbol=%s attempt=%d/%d error_type=%s",
                    symbol,
                    attempt,
                    attempts,
                    type(exc).__name__,
                )
            if attempt < attempts:
                self._sleep(self._retry_delays[attempt - 1])
        return []

    def load(self, symbol: str, minimum_bars: int) -> list[RawKlineBar]:
        del minimum_bars
        current_date = self._today()
        exchange_symbol = f"{'sh' if symbol.startswith('6') else 'sz'}{symbol}"

        def load_from_sina() -> list[RawKlineBar]:
            frame = self._get_akshare().stock_zh_a_daily(
                symbol=exchange_symbol,
                start_date=(current_date - timedelta(days=420)).strftime("%Y%m%d"),
                end_date=current_date.strftime("%Y%m%d"),
                adjust="qfq",
            )
            return _normalize_sina_frame(frame)

        bars = self._load_with_retries(symbol=symbol, loader=load_from_sina)
        if bars:
            return bars
        raise KlineUnavailable("当前真实日线行情暂不可用")
