"""Real Eastmoney daily K-line loading and normalization."""

from collections.abc import Callable, Mapping
from datetime import date, timedelta
import importlib
import math
from typing import Any

import httpx

from app.domain.market_data import KlineUnavailable, RawKlineBar


EASTMONEY_KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"

FetchJson = Callable[[str, dict[str, Any]], Mapping[str, Any]]


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


def _normalize_akshare_frame(frame: Any) -> list[RawKlineBar]:
    rows = [
        {
            "date": row.get("日期"),
            "open": row.get("开盘"),
            "high": row.get("最高"),
            "low": row.get("最低"),
            "close": row.get("收盘"),
            "volume": row.get("成交量"),
            "change_pct": row.get("涨跌幅"),
        }
        for row in _records(frame)
    ]
    return _normalize_rows(rows)


def _normalize_eastmoney_payload(payload: Mapping[str, Any]) -> list[RawKlineBar]:
    data = payload.get("data")
    if not isinstance(data, Mapping):
        return []
    raw_klines = data.get("klines")
    if not isinstance(raw_klines, list):
        return []

    rows: list[Mapping[str, Any]] = []
    for raw in raw_klines:
        fields = str(raw).split(",")
        if len(fields) < 11:
            continue
        rows.append(
            {
                "date": fields[0],
                "open": fields[1],
                "close": fields[2],
                "high": fields[3],
                "low": fields[4],
                "volume": fields[5],
                "change_pct": fields[8],
            }
        )
    return _normalize_rows(rows)


class EastmoneyKlineSource:
    """Load qfq daily bars through AKShare, then Eastmoney directly."""

    def __init__(
        self,
        akshare_module: Any | None = None,
        *,
        proxy: str | None = None,
        fetch_json: FetchJson | None = None,
        today: Callable[[], date] | None = None,
    ) -> None:
        self._akshare = akshare_module
        self._proxy = proxy
        self._fetch_json = fetch_json
        self._today = today or date.today

    def _get_akshare(self) -> Any:
        if self._akshare is None:
            self._akshare = importlib.import_module("akshare")
        return self._akshare

    def _request_direct(self, params: dict[str, Any]) -> Mapping[str, Any]:
        if self._fetch_json is not None:
            return self._fetch_json(EASTMONEY_KLINE_URL, params)
        with httpx.Client(proxy=self._proxy, timeout=20, trust_env=False) as client:
            response = client.get(
                EASTMONEY_KLINE_URL,
                params=params,
                headers={"User-Agent": "Mozilla/5.0 Chrome/124 Safari/537.36"},
            )
            response.raise_for_status()
            payload = response.json()
        return payload if isinstance(payload, Mapping) else {}

    def load(self, symbol: str, minimum_bars: int) -> list[RawKlineBar]:
        current_date = self._today()
        try:
            frame = self._get_akshare().stock_zh_a_hist(
                symbol=symbol,
                period="daily",
                start_date=(current_date - timedelta(days=420)).strftime("%Y%m%d"),
                end_date=current_date.strftime("%Y%m%d"),
                adjust="qfq",
            )
            bars = _normalize_akshare_frame(frame)
            if bars:
                return bars
        except Exception:
            pass

        params = {
            "secid": f"{'1' if symbol.startswith(('600', '601', '603', '605')) else '0'}.{symbol}",
            "klt": 101,
            "fqt": 1,
            "beg": 0,
            "end": 20500101,
            "lmt": max(160, minimum_bars),
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        }
        try:
            bars = _normalize_eastmoney_payload(self._request_direct(params))
            if bars:
                return bars
        except Exception:
            pass
        raise KlineUnavailable("当前真实日线行情暂不可用")
