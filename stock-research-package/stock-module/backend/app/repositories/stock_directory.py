"""SQLite persistence for the validated A-share main-board directory."""

from datetime import datetime
from pathlib import Path
import sqlite3

from pydantic import BaseModel


class InvalidStockDirectory(ValueError):
    """Raised when a replacement directory is incomplete or inconsistent."""


class StockDirectoryEntry(BaseModel):
    symbol: str
    name: str
    exchange: str
    initials: str


class StockDirectoryMetadata(BaseModel):
    source: str
    generated_at: datetime
    count: int


class StockDirectoryRepository:
    def __init__(self, database_path: str | Path, *, minimum_count: int = 1_000) -> None:
        self._path = Path(database_path)
        self._minimum_count = minimum_count
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def replace(
        self,
        entries: list[StockDirectoryEntry],
        *,
        source: str,
        generated_at: datetime,
    ) -> None:
        if len(entries) < self._minimum_count:
            raise InvalidStockDirectory(
                f"股票目录数量异常：需要至少 {self._minimum_count} 条，实际 {len(entries)} 条"
            )
        symbols = [entry.symbol for entry in entries]
        if len(symbols) != len(set(symbols)):
            raise InvalidStockDirectory("股票目录包含重复代码")
        if any(not entry.name.strip() for entry in entries):
            raise InvalidStockDirectory("股票目录包含空名称")

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM stock_directory")
            connection.executemany(
                """
                INSERT INTO stock_directory (symbol, name, exchange, initials)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (entry.symbol, entry.name.strip(), entry.exchange, entry.initials.lower())
                    for entry in entries
                ],
            )
            connection.execute(
                """
                INSERT INTO stock_directory_meta (id, source, generated_at, entry_count)
                VALUES (1, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    source = excluded.source,
                    generated_at = excluded.generated_at,
                    entry_count = excluded.entry_count
                """,
                (source, generated_at.isoformat(), len(entries)),
            )

    def search(self, query: str, limit: int = 20) -> list[StockDirectoryEntry]:
        needle = query.strip().lower()
        pattern = f"%{needle}%"
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT symbol, name, exchange, initials
                FROM stock_directory
                WHERE ? = ''
                   OR lower(symbol) LIKE ?
                   OR lower(name) LIKE ?
                   OR lower(initials) LIKE ?
                ORDER BY symbol
                LIMIT ?
                """,
                (needle, pattern, pattern, pattern, limit),
            ).fetchall()
        return [StockDirectoryEntry.model_validate(dict(row)) for row in rows]

    def metadata(self) -> StockDirectoryMetadata | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT source, generated_at, entry_count FROM stock_directory_meta WHERE id = 1"
            ).fetchone()
        if row is None:
            return None
        return StockDirectoryMetadata(
            source=row["source"],
            generated_at=datetime.fromisoformat(row["generated_at"]),
            count=row["entry_count"],
        )

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS stock_directory (
                    symbol TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    exchange TEXT NOT NULL,
                    initials TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS stock_directory_meta (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    source TEXT NOT NULL,
                    generated_at TEXT NOT NULL,
                    entry_count INTEGER NOT NULL
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path)
        connection.row_factory = sqlite3.Row
        return connection
