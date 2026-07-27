"""Public domain models for normalized daily stock market data."""

from datetime import date as Date
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class RawKlineBar(BaseModel):
    date: Date
    open: float
    high: float
    low: float
    close: float
    volume: float
    change_pct: float | None = None


class KlineBar(RawKlineBar):
    ma5: float | None = None
    ma10: float | None = None
    ma20: float | None = None


class KlineLatest(BaseModel):
    trade_date: Date
    price: float
    change: float
    change_pct: float
    high: float
    low: float
    volume: float


class StockKline(BaseModel):
    symbol: str
    name: str
    exchange: Literal["SSE", "SZSE"]
    period: Literal["daily"] = "daily"
    adjustment: Literal["qfq"] = "qfq"
    days: Literal[20, 60, 120]
    source: Literal["eastmoney"] = "eastmoney"
    generated_at: datetime
    stale: bool = False
    latest: KlineLatest
    bars: list[KlineBar]


class KlineUnavailable(RuntimeError):
    """Raised when neither real daily K-line source returns usable data."""
