from datetime import UTC, datetime
import json
from pathlib import Path

import pandas as pd
import pytest

from workers.ths_hot_concepts import StockSeedData
from workers.user_strategy_snapshot import (
    DEFAULT_TOP_CONCEPTS,
    StockSeed,
    build_snapshot,
    collect_hot_stock_pool,
    load_history_with_fallback,
    normalize_history,
    write_snapshot_atomic,
)


class FakeFrame:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows

    def to_dict(self, orient: str) -> list[dict[str, object]]:
        assert orient == "records"
        return self._rows

    @property
    def empty(self) -> bool:
        return not self._rows


def test_default_concept_scope_covers_many_hot_ths_themes() -> None:
    assert DEFAULT_TOP_CONCEPTS == 30


def test_normalize_history_maps_akshare_columns_and_computes_missing_pct() -> None:
    frame = FakeFrame(
        [
            {"日期": "2026-07-20", "开盘": "10", "最高": "10.5", "最低": "9.8", "收盘": "10", "成交量": "100"},
            {"日期": "2026-07-21", "开盘": "10", "最高": "11.2", "最低": "9.9", "收盘": "11", "成交量": "220"},
        ]
    )

    bars = normalize_history(frame)

    assert bars[0] == {"open": 10.0, "high": 10.5, "low": 9.8, "close": 10.0, "pct": 0.0, "volume": 100.0}
    assert bars[1]["pct"] == 10.0


def test_build_snapshot_filters_non_main_board_and_st_stocks() -> None:
    pool = {
        "600001": StockSeed(symbol="600001", name="主板示例", concepts=["机器人"]),
        "300001": StockSeed(symbol="300001", name="创业示例", concepts=["机器人"]),
        "000001": StockSeed(symbol="000001", name="ST 示例", concepts=["银行"]),
    }
    frame = FakeFrame(
        [
            {"开盘": 10, "最高": 10.5, "最低": 9.8, "收盘": 10, "涨跌幅": 1, "成交量": 100},
            {"开盘": 10, "最高": 11, "最低": 9.9, "收盘": 10.5, "涨跌幅": 5, "成交量": 200},
        ]
    )

    payload = build_snapshot(pool, lambda _: frame, datetime(2026, 7, 21, tzinfo=UTC), min_bars=2)

    assert [stock["symbol"] for stock in payload["stocks"]] == ["600001"]
    assert payload["stocks"][0]["concepts"] == ["机器人"]


def test_atomic_writer_does_not_replace_old_snapshot_with_empty_result(tmp_path: Path) -> None:
    output = tmp_path / "latest.json"
    output.write_text('{"old": true}', encoding="utf-8")

    with pytest.raises(ValueError, match="空快照"):
        write_snapshot_atomic({"generated_at": "now", "stocks": []}, output)

    assert output.read_text(encoding="utf-8") == '{"old": true}'


def test_atomic_writer_writes_complete_snapshot(tmp_path: Path) -> None:
    output = tmp_path / "latest.json"
    payload = {"generated_at": "2026-07-21T15:35:00+08:00", "stocks": [{"symbol": "600001"}]}

    write_snapshot_atomic(payload, output)

    assert json.loads(output.read_text(encoding="utf-8")) == payload
    assert list(tmp_path.glob("*.tmp")) == []


def test_hot_pool_prefers_ths_and_preserves_ranked_concepts() -> None:
    class FakeAkshare:
        def stock_board_concept_name_em(self) -> object:
            raise AssertionError("Eastmoney should not run when THS succeeds")

    def collect_ths(*_args: object, **_kwargs: object) -> dict[str, StockSeedData]:
        return {
            "600001": StockSeedData(
                symbol="600001",
                name="主板甲",
                concepts=["机器人", "人工智能", "低价股"],
            )
        }

    pool = collect_hot_stock_pool(
        FakeAkshare(),
        top_concepts=10,
        max_stocks=120,
        concept_cache=None,
        ths_collector=collect_ths,
    )

    assert pool["600001"] == StockSeed(
        symbol="600001",
        name="主板甲",
        concepts=["机器人", "人工智能", "低价股"],
    )


def test_hot_pool_uses_eastmoney_when_ths_is_unavailable() -> None:
    class FakeAkshare:
        def stock_board_concept_name_em(self) -> pd.DataFrame:
            return pd.DataFrame([{"板块名称": "算力", "涨跌幅": 5.0, "换手率": 3.0}])

        def stock_board_concept_cons_em(self, *, symbol: str) -> pd.DataFrame:
            assert symbol == "算力"
            return pd.DataFrame([{"代码": "600001", "名称": "主板甲"}])

    pool = collect_hot_stock_pool(
        FakeAkshare(),
        top_concepts=10,
        max_stocks=120,
        concept_cache=None,
        ths_collector=_unavailable_ths,
    )

    assert pool["600001"].concepts == ["算力"]


def test_hot_pool_falls_back_to_sina_market_when_concept_api_fails() -> None:
    class FakeAkshare:
        def stock_board_concept_name_em(self) -> object:
            raise ConnectionError("concept endpoint unavailable")

        def stock_zh_a_spot(self) -> FakeFrame:
            return FakeFrame(
                [
                    {"代码": "sh600001", "名称": "主板甲", "涨跌幅": 3.2, "成交量": 500},
                    {"代码": "sz000001", "名称": "主板乙", "涨跌幅": 4.1, "成交量": 400},
                    {"代码": "sz300001", "名称": "创业板", "涨跌幅": 9.0, "成交量": 900},
                ]
            )

        def stock_sector_spot(self, *, indicator: str) -> FakeFrame:
            assert indicator == "新浪行业"
            return FakeFrame(
                [
                    {"label": "new_bank", "板块": "银行"},
                    {"label": "new_equipment", "板块": "专用设备"},
                ]
            )

        def stock_sector_detail(self, *, sector: str) -> FakeFrame:
            members = {
                "new_bank": [{"code": "000001", "name": "主板乙"}],
                "new_equipment": [{"code": "600001", "name": "主板甲"}],
            }
            return FakeFrame(members[sector])

    pool = collect_hot_stock_pool(
        FakeAkshare(),
        top_concepts=10,
        max_stocks=2,
        concept_cache=None,
        ths_collector=_unavailable_ths,
    )

    assert list(pool) == ["000001", "600001"]
    assert pool["000001"].concepts == ["银行"]
    assert pool["600001"].concepts == ["专用设备"]


def test_hot_pool_marks_missing_theme_honestly_when_sector_lookup_fails() -> None:
    class FakeAkshare:
        def stock_board_concept_name_em(self) -> object:
            raise ConnectionError("concept endpoint unavailable")

        def stock_zh_a_spot(self) -> FakeFrame:
            return FakeFrame(
                [{"代码": "sh600001", "名称": "主板甲", "涨跌幅": 3.2, "成交量": 500}]
            )

        def stock_sector_spot(self, *, indicator: str) -> object:
            raise ConnectionError(f"{indicator} unavailable")

    pool = collect_hot_stock_pool(
        FakeAkshare(),
        top_concepts=10,
        max_stocks=1,
        concept_cache=None,
        ths_collector=_unavailable_ths,
    )

    assert pool["600001"].concepts == ["题材暂不可用"]


def test_history_loader_uses_sina_when_eastmoney_fails() -> None:
    fallback = FakeFrame([{"open": 10, "high": 11, "low": 9, "close": 10.5, "volume": 100}])

    class FakeAkshare:
        def stock_zh_a_hist(self, **_: object) -> object:
            raise ConnectionError("eastmoney unavailable")

        def stock_zh_a_daily(self, **kwargs: object) -> FakeFrame:
            assert kwargs["symbol"] == "sh600001"
            return fallback

    assert load_history_with_fallback(FakeAkshare(), "600001", "20250101", "20260722") is fallback


def _unavailable_ths(*_args: object, **_kwargs: object) -> dict[str, StockSeedData]:
    raise ConnectionError("THS unavailable")
