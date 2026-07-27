import pandas as pd

from app.integrations.stock_directory_sources import (
    AkshareStockDirectorySource,
    normalize_directory_rows,
)


class FakeAkshare:
    def __init__(self, *, primary=None, sh=None, sz=None, primary_error=None) -> None:
        self.primary = primary
        self.sh = sh
        self.sz = sz
        self.primary_error = primary_error

    def stock_info_a_code_name(self):
        if self.primary_error:
            raise self.primary_error
        return self.primary

    def stock_sh_a_spot_em(self):
        return self.sh

    def stock_sz_a_spot_em(self):
        return self.sz


def test_normalize_directory_rows_filters_unsupported_and_risk_names() -> None:
    rows = [
        {"code": "600519", "name": "贵州茅台"},
        {"code": "688001", "name": "华兴源创"},
        {"code": "300750", "name": "宁德时代"},
        {"code": "920001", "name": "北交测试"},
        {"code": "000001", "name": "ST平安"},
        {"code": "600001", "name": "退市测试"},
    ]

    entries = normalize_directory_rows(rows)

    assert [(item.symbol, item.name, item.exchange) for item in entries] == [
        ("600519", "贵州茅台", "SSE")
    ]
    assert entries[0].initials == "gzmt"


def test_akshare_source_falls_back_to_combined_eastmoney_markets() -> None:
    source = AkshareStockDirectorySource(
        FakeAkshare(
            primary_error=ConnectionError("primary unavailable"),
            sh=pd.DataFrame([{"代码": "600519", "名称": "贵州茅台"}]),
            sz=pd.DataFrame([{"代码": "002594", "名称": "比亚迪"}]),
        )
    )

    batch = source.load()

    assert batch.source == "eastmoney_spot_fallback"
    assert [item.symbol for item in batch.entries] == ["600519", "002594"]

