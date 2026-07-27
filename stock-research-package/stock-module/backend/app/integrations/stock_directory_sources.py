"""External sources and normalization for the complete stock directory."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from pypinyin import lazy_pinyin

from app.domain.stocks import InvalidMainBoardSymbol, exchange_for, normalize_symbol
from app.repositories.stock_directory import StockDirectoryEntry


class StockDirectorySourceUnavailable(RuntimeError):
    """Raised when both the primary and fallback directory sources fail."""


@dataclass(frozen=True)
class StockDirectoryBatch:
    source: str
    entries: list[StockDirectoryEntry]


def _value(row: Mapping[str, Any], *names: str) -> str:
    for name in names:
        value = row.get(name)
        if value is not None:
            return str(value).strip()
    return ""


def _is_risk_name(name: str) -> bool:
    upper = name.upper().replace(" ", "")
    return "ST" in upper or "退市" in name


def _initials(name: str) -> str:
    return "".join(part[0] for part in lazy_pinyin(name) if part).lower()


def normalize_directory_rows(rows: Iterable[Mapping[str, Any]]) -> list[StockDirectoryEntry]:
    entries: list[StockDirectoryEntry] = []
    for row in rows:
        raw_symbol = _value(row, "code", "代码", "symbol", "股票代码")
        name = _value(row, "name", "名称", "股票简称")
        if not raw_symbol or not name or _is_risk_name(name):
            continue
        try:
            symbol = normalize_symbol(raw_symbol)
        except InvalidMainBoardSymbol:
            continue
        entries.append(
            StockDirectoryEntry(
                symbol=symbol,
                name=name,
                exchange=exchange_for(symbol),
                initials=_initials(name),
            )
        )
    return entries


def _records(frame: Any) -> list[dict[str, Any]]:
    if frame is None:
        return []
    if hasattr(frame, "to_dict"):
        return frame.to_dict(orient="records")
    return list(frame)


class AkshareStockDirectorySource:
    def __init__(self, akshare_module=None) -> None:
        if akshare_module is None:
            import akshare as akshare_module

        self._akshare = akshare_module

    def load(self) -> StockDirectoryBatch:
        try:
            primary = self._akshare.stock_info_a_code_name()
            return StockDirectoryBatch(
                source="akshare_code_name",
                entries=normalize_directory_rows(_records(primary)),
            )
        except Exception as primary_error:
            try:
                rows = [
                    *_records(self._akshare.stock_sh_a_spot_em()),
                    *_records(self._akshare.stock_sz_a_spot_em()),
                ]
                return StockDirectoryBatch(
                    source="eastmoney_spot_fallback",
                    entries=normalize_directory_rows(rows),
                )
            except Exception as fallback_error:
                raise StockDirectorySourceUnavailable(str(fallback_error)) from primary_error
