import logging
from datetime import UTC, date, datetime

import pytest

from app.domain.market_data import KlineUnavailable
from app.integrations.market_data import SinaKlineSource


class FakeFrame:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows

    @property
    def empty(self) -> bool:
        return not self._rows

    def to_dict(self, *, orient: str) -> list[dict]:
        assert orient == "records"
        return self._rows


class FakeAkshare:
    def __init__(self, frame: FakeFrame | None = None, error: Exception | None = None) -> None:
        self.frame = frame
        self.error = error
        self.kwargs: dict = {}
        self.calls = 0

    def stock_zh_a_daily(self, **kwargs):
        self.kwargs = kwargs
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.frame


def test_sina_source_normalizes_qfq_daily_bars() -> None:
    frame = FakeFrame(
        [
            {
                "date": "2026-07-24",
                "open": 10,
                "high": 11,
                "low": 9.8,
                "close": 10.5,
                "volume": 1000,
                "change_pct": 2.0,
            },
            {
                "date": "2026-07-25",
                "open": 10.5,
                "high": 11.2,
                "low": 10.2,
                "close": 11,
                "volume": 1200,
                "change_pct": 4.76,
            },
        ]
    )
    akshare = FakeAkshare(frame)

    result = SinaKlineSource(akshare).load("600519", minimum_bars=2)

    assert akshare.kwargs["symbol"] == "sh600519"
    assert akshare.kwargs["adjust"] == "qfq"
    assert akshare.kwargs["end_date"] == date.today().strftime("%Y%m%d")
    assert result[0].date.isoformat() == "2026-07-24"
    assert result[1].close == 11
    assert result[1].volume == 1200


def test_sina_source_sorts_bars_and_keeps_last_duplicate_date() -> None:
    frame = FakeFrame(
        [
            {
                "date": "2026-07-25",
                "open": 10.5,
                "high": 11.2,
                "low": 10.2,
                "close": 11,
                "volume": 1200,
                "change_pct": 4.76,
            },
            {
                "date": "2026-07-24",
                "open": 10,
                "high": 11,
                "low": 9.8,
                "close": 10.5,
                "volume": 1000,
                "change_pct": 2.0,
            },
            {
                "date": "2026-07-25",
                "open": 10.7,
                "high": 11.4,
                "low": 10.3,
                "close": 11.3,
                "volume": 1300,
                "change_pct": 7.62,
            },
        ]
    )

    result = SinaKlineSource(FakeAkshare(frame)).load("600519", minimum_bars=2)

    assert [bar.date.isoformat() for bar in result] == ["2026-07-24", "2026-07-25"]
    assert result[-1].close == 11.3


def test_sina_source_discards_rows_with_invalid_numeric_cells() -> None:
    frame = FakeFrame(
        [
            {
                "date": "2026-07-24",
                "open": 10,
                "high": 11,
                "low": 9.8,
                "close": 10.5,
                "volume": 1000,
                "change_pct": 2.0,
            },
            {
                "date": "2026-07-25",
                "open": 10.5,
                "high": float("nan"),
                "low": 10.2,
                "close": 11,
                "volume": 1200,
                "change_pct": 4.76,
            },
            {
                "date": "2026-07-26",
                "open": 11,
                "high": 11.5,
                "low": 10.8,
                "close": "not-a-number",
                "volume": 900,
                "change_pct": None,
            },
        ]
    )

    result = SinaKlineSource(FakeAkshare(frame)).load("600519", minimum_bars=1)

    assert [bar.date.isoformat() for bar in result] == ["2026-07-24"]


def test_sina_source_retries_after_temporary_failure() -> None:
    sleeps: list[float] = []

    class FlakyAkshare(FakeAkshare):
        def stock_zh_a_daily(self, **kwargs):
            self.kwargs = kwargs
            self.calls += 1
            if self.calls == 1:
                raise ConnectionError("temporary Sina failure")
            return FakeFrame(
                [
                    {
                        "date": "2026-08-14",
                        "open": 10,
                        "high": 11,
                        "low": 9,
                        "close": 10.5,
                        "volume": 100,
                    }
                ]
            )

    akshare = FlakyAkshare()
    result = SinaKlineSource(
        akshare,
        sleep=sleeps.append,
        retry_delays=(0.0, 0.0),
    ).load("600519", minimum_bars=1)

    assert len(result) == 1
    assert akshare.calls == 2
    assert sleeps == [0.0]


def test_sina_source_accepts_common_chinese_and_english_columns() -> None:
    frame = FakeFrame(
        [
            {
                "日期": "2026-08-14",
                "开盘": 10,
                "最高": 11,
                "最低": 9,
                "收盘": 10.5,
                "成交量": 100,
                "涨跌幅": 1.2,
            }
        ]
    )

    result = SinaKlineSource(FakeAkshare(frame)).load("000001", minimum_bars=1)

    assert result[-1].close == 10.5


def test_sina_source_uses_shanghai_today_for_request_window() -> None:
    akshare = FakeAkshare(FakeFrame([]))
    source = SinaKlineSource(
        akshare,
        now=lambda: datetime(2026, 8, 13, 16, 30, tzinfo=UTC),
        sleep=lambda _delay: None,
        retry_delays=(0.0,),
    )

    with pytest.raises(KlineUnavailable):
        source.load("000001", minimum_bars=1)

    assert akshare.kwargs["symbol"] == "sz000001"
    assert akshare.kwargs["end_date"] == "20260814"


def test_sina_source_exhaustion_hides_raw_upstream_errors(caplog) -> None:
    sleeps: list[float] = []
    source = SinaKlineSource(
        FakeAkshare(error=RuntimeError("secret upstream response body")),
        sleep=sleeps.append,
        retry_delays=(0.0, 0.0),
    )

    with caplog.at_level(logging.WARNING):
        with pytest.raises(KlineUnavailable) as exc_info:
            source.load("002594", minimum_bars=1)

    assert "secret upstream response body" not in str(exc_info.value)
    assert sleeps == [0.0, 0.0]
    assert caplog.records
    assert all("secret upstream response body" not in record.getMessage() for record in caplog.records)
