"""SQLite persistence for normalized daily K-line snapshots."""

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
import sqlite3

from app.domain.market_data import RawKlineBar


@dataclass(frozen=True)
class CachedKline:
    bars: list[RawKlineBar]
    fetched_at: datetime


class KlineRepository:
    def __init__(self, database_path: str | Path) -> None:
        self._path = Path(database_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def save(
        self,
        symbol: str,
        bars: list[RawKlineBar],
        fetched_at: datetime,
    ) -> None:
        if fetched_at.tzinfo is None or fetched_at.utcoffset() is None:
            raise ValueError("fetched_at must be timezone-aware")
        payload = json.dumps(
            [bar.model_dump(mode="json") for bar in bars],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO stock_kline_cache (symbol, bars_json, fetched_at)
                VALUES (?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    bars_json = excluded.bars_json,
                    fetched_at = excluded.fetched_at
                """,
                (symbol, payload, fetched_at.isoformat()),
            )

    def get(self, symbol: str) -> CachedKline | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT bars_json, fetched_at
                FROM stock_kline_cache
                WHERE symbol = ?
                """,
                (symbol,),
            ).fetchone()
        if row is None:
            return None

        fetched_at = datetime.fromisoformat(row["fetched_at"])
        if fetched_at.tzinfo is None or fetched_at.utcoffset() is None:
            raise ValueError("cached fetched_at must be timezone-aware")
        raw_bars = json.loads(row["bars_json"])
        return CachedKline(
            bars=[RawKlineBar.model_validate(item) for item in raw_bars],
            fetched_at=fetched_at,
        )

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS stock_kline_cache (
                    symbol TEXT PRIMARY KEY,
                    bars_json TEXT NOT NULL,
                    fetched_at TEXT NOT NULL
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path)
        connection.row_factory = sqlite3.Row
        return connection
