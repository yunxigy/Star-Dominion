"""Cached daily K-line orchestration and moving-average calculation."""

from collections.abc import Callable
from datetime import UTC, datetime, time, timedelta
from typing import Literal, Protocol
from zoneinfo import ZoneInfo

from app.domain.market_data import (
    KlineBar,
    KlineLatest,
    KlineUnavailable,
    RawKlineBar,
    StockKline,
)
from app.domain.stocks import exchange_for, normalize_symbol
from app.repositories.kline_cache import CachedKline, KlineRepository


KlineDays = Literal[20, 60, 120]
SUPPORTED_DAYS = (20, 60, 120)
SHANGHAI = ZoneInfo("Asia/Shanghai")
TRADING_TTL = timedelta(minutes=5)
OFF_HOURS_TTL = timedelta(minutes=30)
STALE_LIMIT = timedelta(days=14)


class KlineSource(Protocol):
    def load(self, symbol: str, minimum_bars: int) -> list[RawKlineBar]: ...


class StockDirectoryLike(Protocol):
    def search(self, query: str, limit: int = 20): ...


class KlineService:
    def __init__(
        self,
        repository: KlineRepository,
        source: KlineSource,
        *,
        directory: StockDirectoryLike | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._source = source
        self._directory = directory
        self._clock = clock or (lambda: datetime.now(UTC))

    def get(self, symbol: str, days: int = 60) -> StockKline:
        normalized = normalize_symbol(symbol)
        if days not in SUPPORTED_DAYS:
            raise ValueError("K 线周期仅支持 20、60 或 120 个交易日")

        now = self._clock()
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("clock must return a timezone-aware datetime")

        cached = self._repository.get(normalized)
        if cached is not None and self._is_fresh(cached, now):
            return self._build_result(
                normalized,
                days,
                cached.bars,
                generated_at=cached.fetched_at,
                stale=False,
            )

        try:
            bars = self._source.load(normalized, minimum_bars=140)
            if not bars:
                raise KlineUnavailable("当前真实日线行情暂不可用")
        except KlineUnavailable:
            if cached is not None and self._age(cached, now) <= STALE_LIMIT:
                return self._build_result(
                    normalized,
                    days,
                    cached.bars,
                    generated_at=cached.fetched_at,
                    stale=True,
                )
            raise

        self._repository.save(normalized, bars, now)
        return self._build_result(
            normalized,
            days,
            bars,
            generated_at=now,
            stale=False,
        )

    def _is_fresh(self, cached: CachedKline, now: datetime) -> bool:
        local = now.astimezone(SHANGHAI)
        in_trading_window = (
            local.weekday() < 5
            and time(9, 15) <= local.time() <= time(15, 15)
        )
        ttl = TRADING_TTL if in_trading_window else OFF_HOURS_TTL
        return self._age(cached, now) <= ttl

    @staticmethod
    def _age(cached: CachedKline, now: datetime) -> timedelta:
        return max(now - cached.fetched_at, timedelta())

    def _build_result(
        self,
        symbol: str,
        days: int,
        raw_bars: list[RawKlineBar],
        *,
        generated_at: datetime,
        stale: bool,
    ) -> StockKline:
        if not raw_bars:
            raise KlineUnavailable("当前真实日线行情暂不可用")

        bars = self._with_moving_averages(raw_bars)
        selected = bars[-days:]
        latest_raw = raw_bars[-1]
        previous_close = raw_bars[-2].close if len(raw_bars) > 1 else latest_raw.close
        change = latest_raw.close - previous_close
        change_pct = (
            change / previous_close * 100
            if previous_close
            else (latest_raw.change_pct or 0.0)
        )
        return StockKline(
            symbol=symbol,
            name=self._resolve_name(symbol),
            exchange=exchange_for(symbol),
            days=days,
            generated_at=generated_at,
            stale=stale,
            latest=KlineLatest(
                trade_date=latest_raw.date,
                price=latest_raw.close,
                change=change,
                change_pct=change_pct,
                high=latest_raw.high,
                low=latest_raw.low,
                volume=latest_raw.volume,
            ),
            bars=selected,
        )

    @staticmethod
    def _with_moving_averages(raw_bars: list[RawKlineBar]) -> list[KlineBar]:
        closes = [bar.close for bar in raw_bars]

        def average(index: int, window: int) -> float | None:
            if index + 1 < window:
                return None
            values = closes[index + 1 - window : index + 1]
            return sum(values) / window

        return [
            KlineBar(
                **bar.model_dump(),
                ma5=average(index, 5),
                ma10=average(index, 10),
                ma20=average(index, 20),
            )
            for index, bar in enumerate(raw_bars)
        ]

    def _resolve_name(self, symbol: str) -> str:
        if self._directory is None:
            return symbol
        for candidate in self._directory.search(symbol, 20):
            if candidate.symbol == symbol and candidate.name.strip():
                return candidate.name.strip()
        return symbol
