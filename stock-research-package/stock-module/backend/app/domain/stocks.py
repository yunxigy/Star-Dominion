"""A-share main-board symbol validation and normalization."""

import re

MAIN_BOARD_PREFIXES = ("600", "601", "603", "605", "000", "001", "002")


class InvalidMainBoardSymbol(ValueError):
    """Raised when a symbol is not a supported A-share main-board code."""


def normalize_symbol(raw: str) -> str:
    """Return a six-digit main-board symbol or raise a domain error."""
    candidate = str(raw).strip().lower()
    candidate = re.sub(r"^(sh|sz)", "", candidate)
    if not re.fullmatch(r"\d{6}", candidate):
        raise InvalidMainBoardSymbol("仅支持六位 A 股主板代码")
    if not candidate.startswith(MAIN_BOARD_PREFIXES):
        raise InvalidMainBoardSymbol("仅支持 A 股主板股票")
    return candidate


def exchange_for(symbol: str) -> str:
    """Return the listing exchange for a supported main-board symbol."""
    normalized = normalize_symbol(symbol)
    if normalized.startswith(("600", "601", "603", "605")):
        return "SSE"
    return "SZSE"
