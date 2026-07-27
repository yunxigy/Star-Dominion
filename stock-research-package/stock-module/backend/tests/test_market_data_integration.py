from datetime import date

import pytest

from app.domain.market_data import KlineUnavailable
from app.integrations.market_data import EastmoneyKlineSource


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

    def stock_zh_a_hist(self, **kwargs):
        self.kwargs = kwargs
        if self.error is not None:
            raise self.error
        return self.frame


def test_eastmoney_source_normalizes_qfq_daily_bars() -> None:
    frame = FakeFrame(
        [
            {
                "日期": "2026-07-24",
                "开盘": 10,
                "最高": 11,
                "最低": 9.8,
                "收盘": 10.5,
                "成交量": 1000,
                "涨跌幅": 2.0,
            },
            {
                "日期": "2026-07-25",
                "开盘": 10.5,
                "最高": 11.2,
                "最低": 10.2,
                "收盘": 11,
                "成交量": 1200,
                "涨跌幅": 4.76,
            },
        ]
    )
    akshare = FakeAkshare(frame)

    result = EastmoneyKlineSource(akshare).load("600519", minimum_bars=2)

    assert akshare.kwargs["symbol"] == "600519"
    assert akshare.kwargs["period"] == "daily"
    assert akshare.kwargs["adjust"] == "qfq"
    assert akshare.kwargs["end_date"] == date.today().strftime("%Y%m%d")
    assert result[0].date.isoformat() == "2026-07-24"
    assert result[1].close == 11
    assert result[1].volume == 1200


def test_eastmoney_source_sorts_bars_and_keeps_last_duplicate_date() -> None:
    frame = FakeFrame(
        [
            {
                "日期": "2026-07-25",
                "开盘": 10.5,
                "最高": 11.2,
                "最低": 10.2,
                "收盘": 11,
                "成交量": 1200,
                "涨跌幅": 4.76,
            },
            {
                "日期": "2026-07-24",
                "开盘": 10,
                "最高": 11,
                "最低": 9.8,
                "收盘": 10.5,
                "成交量": 1000,
                "涨跌幅": 2.0,
            },
            {
                "日期": "2026-07-25",
                "开盘": 10.7,
                "最高": 11.4,
                "最低": 10.3,
                "收盘": 11.3,
                "成交量": 1300,
                "涨跌幅": 7.62,
            },
        ]
    )

    result = EastmoneyKlineSource(FakeAkshare(frame)).load("600519", minimum_bars=2)

    assert [bar.date.isoformat() for bar in result] == ["2026-07-24", "2026-07-25"]
    assert result[-1].close == 11.3


def test_eastmoney_source_discards_rows_with_invalid_numeric_cells() -> None:
    frame = FakeFrame(
        [
            {
                "日期": "2026-07-24",
                "开盘": 10,
                "最高": 11,
                "最低": 9.8,
                "收盘": 10.5,
                "成交量": 1000,
                "涨跌幅": 2.0,
            },
            {
                "日期": "2026-07-25",
                "开盘": 10.5,
                "最高": float("nan"),
                "最低": 10.2,
                "收盘": 11,
                "成交量": 1200,
                "涨跌幅": 4.76,
            },
            {
                "日期": "2026-07-26",
                "开盘": 11,
                "最高": 11.5,
                "最低": 10.8,
                "收盘": "not-a-number",
                "成交量": 900,
                "涨跌幅": None,
            },
        ]
    )

    result = EastmoneyKlineSource(FakeAkshare(frame)).load("600519", minimum_bars=1)

    assert [bar.date.isoformat() for bar in result] == ["2026-07-24"]


def test_eastmoney_source_falls_back_to_direct_history_api() -> None:
    captured: dict = {}

    def fetch_json(url: str, params: dict) -> dict:
        captured["url"] = url
        captured["params"] = params
        return {
            "data": {
                "klines": [
                    "2026-07-24,10,10.5,11,9.8,1000,100000,12,2,0.2,1.5",
                    "2026-07-25,10.5,11,11.2,10.2,1200,120000,9,4.76,0.5,1.8",
                ]
            }
        }

    source = EastmoneyKlineSource(
        FakeAkshare(error=ConnectionError("AKShare unavailable")),
        fetch_json=fetch_json,
    )

    result = source.load("600519", minimum_bars=2)

    assert captured["url"] == "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    assert captured["params"]["secid"] == "1.600519"
    assert captured["params"]["klt"] == 101
    assert captured["params"]["fqt"] == 1
    assert captured["params"]["lmt"] == 160
    assert result[-1].date.isoformat() == "2026-07-25"
    assert result[-1].high == 11.2
    assert result[-1].change_pct == 4.76


@pytest.mark.parametrize(
    ("frame", "direct_payload"),
    [
        (FakeFrame([]), {"data": {"klines": []}}),
        (None, {"data": None}),
    ],
)
def test_eastmoney_source_raises_domain_error_when_both_sources_are_empty(
    frame: FakeFrame | None,
    direct_payload: dict,
) -> None:
    source = EastmoneyKlineSource(
        FakeAkshare(frame),
        fetch_json=lambda _url, _params: direct_payload,
    )

    with pytest.raises(KlineUnavailable, match="真实日线行情暂不可用"):
        source.load("000001", minimum_bars=1)


def test_eastmoney_source_hides_raw_upstream_errors() -> None:
    def fail_direct(_url: str, _params: dict) -> dict:
        raise RuntimeError("secret upstream response body")

    source = EastmoneyKlineSource(
        FakeAkshare(error=RuntimeError("AKShare stack details")),
        fetch_json=fail_direct,
    )

    with pytest.raises(KlineUnavailable) as exc_info:
        source.load("002594", minimum_bars=1)

    assert "secret upstream response body" not in str(exc_info.value)
    assert "AKShare stack details" not in str(exc_info.value)


def test_eastmoney_direct_client_uses_only_the_configured_proxy(monkeypatch) -> None:
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict:
            return {
                "data": {
                    "klines": [
                        "2026-07-25,10.5,11,11.2,10.2,1200,120000,9,4.76,0.5,1.8"
                    ]
                }
            }

    class FakeClient:
        def __init__(self, **kwargs) -> None:
            captured["client_kwargs"] = kwargs

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            pass

        def get(self, _url: str, **_kwargs) -> FakeResponse:
            return FakeResponse()

    monkeypatch.setattr("app.integrations.market_data.httpx.Client", FakeClient)
    source = EastmoneyKlineSource(
        FakeAkshare(frame=FakeFrame([])),
        proxy="http://127.0.0.1:7890",
    )

    result = source.load("600519", minimum_bars=1)

    assert result[-1].close == 11
    assert captured["client_kwargs"] == {
        "proxy": "http://127.0.0.1:7890",
        "timeout": 20,
        "trust_env": False,
    }
