from datetime import UTC, datetime

import pytest

from app.integrations.stock_directory_sources import StockDirectoryBatch
from app.repositories.stock_directory import StockDirectoryEntry, StockDirectoryRepository
from app.services.stock_directory_refresh import (
    StockDirectoryRefreshFailed,
    StockDirectoryRefreshService,
)


def entry(symbol: str, name: str, exchange: str, initials: str) -> StockDirectoryEntry:
    return StockDirectoryEntry(
        symbol=symbol,
        name=name,
        exchange=exchange,
        initials=initials,
    )


class StaticSource:
    def __init__(self, batch=None, error=None) -> None:
        self.batch = batch
        self.error = error

    def load(self):
        if self.error:
            raise self.error
        return self.batch


def test_refresh_replaces_directory_after_validation(tmp_path) -> None:
    repository = StockDirectoryRepository(tmp_path / "hub.db", minimum_count=1)
    now = datetime(2026, 7, 27, 1, 30, tzinfo=UTC)
    service = StockDirectoryRefreshService(
        repository,
        StaticSource(StockDirectoryBatch(source="primary", entries=[entry("600519", "贵州茅台", "SSE", "gzmt")])),
        clock=lambda: now,
    )

    metadata = service.refresh()

    assert metadata.source == "primary"
    assert metadata.generated_at == now
    assert repository.search("茅台", 20)[0].symbol == "600519"


def test_failed_refresh_preserves_last_valid_snapshot(tmp_path) -> None:
    repository = StockDirectoryRepository(tmp_path / "hub.db", minimum_count=1)
    repository.replace(
        [entry("600519", "贵州茅台", "SSE", "gzmt")],
        source="seed",
        generated_at=datetime(2026, 7, 26, tzinfo=UTC),
    )
    service = StockDirectoryRefreshService(
        repository,
        StaticSource(error=ConnectionError("offline")),
    )

    with pytest.raises(StockDirectoryRefreshFailed, match="offline"):
        service.refresh()

    assert repository.search("600519", 20)[0].name == "贵州茅台"
    assert repository.metadata().source == "seed"
