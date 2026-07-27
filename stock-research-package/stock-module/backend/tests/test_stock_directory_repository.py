from datetime import UTC, datetime

import pytest

from app.repositories.stock_directory import (
    InvalidStockDirectory,
    StockDirectoryEntry,
    StockDirectoryRepository,
)
from app.services.stock_directory import StockDirectory


def entry(symbol: str, name: str, exchange: str, initials: str) -> StockDirectoryEntry:
    return StockDirectoryEntry(
        symbol=symbol,
        name=name,
        exchange=exchange,
        initials=initials,
    )


def test_replace_persists_metadata_and_searches_code_name_and_initials(tmp_path) -> None:
    repository = StockDirectoryRepository(tmp_path / "hub.db", minimum_count=1)
    generated_at = datetime(2026, 7, 27, 1, 30, tzinfo=UTC)

    repository.replace(
        [
            entry("600519", "贵州茅台", "SSE", "gzmt"),
            entry("000001", "平安银行", "SZSE", "payh"),
        ],
        source="akshare_code_name",
        generated_at=generated_at,
    )

    directory = StockDirectory(repository)
    assert [item.symbol for item in directory.search("6005")] == ["600519"]
    assert [item.symbol for item in directory.search("茅台")] == ["600519"]
    assert [item.symbol for item in directory.search("GZMT")] == ["600519"]
    assert repository.metadata().generated_at == generated_at
    assert repository.metadata().source == "akshare_code_name"
    assert repository.metadata().count == 2


def test_replace_rejects_too_few_entries_without_destroying_existing_snapshot(tmp_path) -> None:
    repository = StockDirectoryRepository(tmp_path / "hub.db", minimum_count=2)
    repository.replace(
        [
            entry("600519", "贵州茅台", "SSE", "gzmt"),
            entry("000001", "平安银行", "SZSE", "payh"),
        ],
        source="seed",
        generated_at=datetime(2026, 7, 26, tzinfo=UTC),
    )

    with pytest.raises(InvalidStockDirectory, match="数量"):
        repository.replace(
            [entry("002594", "比亚迪", "SZSE", "byd")],
            source="broken",
            generated_at=datetime(2026, 7, 27, tzinfo=UTC),
        )

    assert [item.symbol for item in repository.search("", 20)] == ["000001", "600519"]
    assert repository.metadata().source == "seed"


def test_replace_rejects_duplicate_symbols(tmp_path) -> None:
    repository = StockDirectoryRepository(tmp_path / "hub.db", minimum_count=1)

    with pytest.raises(InvalidStockDirectory, match="重复"):
        repository.replace(
            [
                entry("600519", "贵州茅台", "SSE", "gzmt"),
                entry("600519", "冲突名称", "SSE", "ctmc"),
            ],
            source="broken",
            generated_at=datetime(2026, 7, 27, tzinfo=UTC),
        )
