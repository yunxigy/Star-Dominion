"""Validated refresh orchestration for the persisted stock directory."""

from collections.abc import Callable
from datetime import UTC, datetime

from app.repositories.stock_directory import (
    StockDirectoryMetadata,
    StockDirectoryRepository,
)


class StockDirectoryRefreshFailed(RuntimeError):
    """Raised when a source or validation failure prevents replacement."""


class StockDirectoryRefreshService:
    def __init__(
        self,
        repository: StockDirectoryRepository,
        source,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._source = source
        self._clock = clock or (lambda: datetime.now(UTC))

    def refresh(self) -> StockDirectoryMetadata:
        try:
            batch = self._source.load()
            self._repository.replace(
                batch.entries,
                source=batch.source,
                generated_at=self._clock(),
            )
        except Exception as exc:
            raise StockDirectoryRefreshFailed(str(exc)) from exc
        metadata = self._repository.metadata()
        if metadata is None:
            raise StockDirectoryRefreshFailed("股票目录刷新后缺少元数据")
        return metadata
