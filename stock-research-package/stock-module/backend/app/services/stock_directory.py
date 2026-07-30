"""Searchable stock directory with main-board filtering."""

from pydantic import BaseModel

from app.domain.stocks import InvalidMainBoardSymbol, exchange_for, normalize_symbol
from app.repositories.stock_directory import StockDirectoryRepository


class StockRecord(BaseModel):
    symbol: str
    name: str


class StockSearchResult(BaseModel):
    symbol: str
    name: str
    exchange: str


class InMemoryStockDirectory:
    def __init__(self, records: list[StockRecord]) -> None:
        self._records: list[StockSearchResult] = []
        for record in records:
            try:
                symbol = normalize_symbol(record.symbol)
            except InvalidMainBoardSymbol:
                continue
            self._records.append(
                StockSearchResult(
                    symbol=symbol,
                    name=record.name,
                    exchange=exchange_for(symbol),
                )
            )

    def search(self, query: str, limit: int = 20) -> list[StockSearchResult]:
        needle = query.strip().lower()
        if not needle:
            return []
        return [
            record
            for record in self._records
            if needle in record.symbol or needle in record.name.lower()
        ][:limit]


class StockDirectory:
    """Search facade backed by the atomically replaced SQLite directory."""

    def __init__(self, repository: StockDirectoryRepository) -> None:
        self._repository = repository

    def search(self, query: str, limit: int = 20) -> list[StockSearchResult]:
        return [
            StockSearchResult(
                symbol=entry.symbol,
                name=entry.name,
                exchange=entry.exchange,
            )
            for entry in self._repository.search(query, limit)
        ]

    def metadata(self):
        return self._repository.metadata()
