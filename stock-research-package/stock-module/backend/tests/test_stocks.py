import pytest

from app.domain.stocks import InvalidMainBoardSymbol, exchange_for, normalize_symbol


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("600519", "600519"),
        ("sh600519", "600519"),
        ("SZ000001", "000001"),
        (" 002594 ", "002594"),
        ("605499", "605499"),
    ],
)
def test_normalize_symbol_accepts_main_board_codes(raw: str, expected: str) -> None:
    assert normalize_symbol(raw) == expected


@pytest.mark.parametrize("raw", ["300750", "301001", "688981", "689009", "920001", "abc"])
def test_normalize_symbol_rejects_non_main_board_codes(raw: str) -> None:
    with pytest.raises(InvalidMainBoardSymbol):
        normalize_symbol(raw)


@pytest.mark.parametrize(
    ("symbol", "expected"),
    [("600519", "SSE"), ("605499", "SSE"), ("000001", "SZSE"), ("002594", "SZSE")],
)
def test_exchange_for_returns_listing_exchange(symbol: str, expected: str) -> None:
    assert exchange_for(symbol) == expected

