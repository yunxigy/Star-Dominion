from datetime import UTC, date, datetime

import httpx
import pytest

from app.domain.market_data import (
    KlineBar,
    KlineLatest,
    KlineUnavailable,
    StockKline,
)
from app.domain.stocks import normalize_symbol
from app.main import create_app


class FakeKlineService:
    def __init__(self, *, unavailable: bool = False) -> None:
        self.unavailable = unavailable
        self.calls: list[tuple[str, int]] = []

    def get(self, symbol: str, days: int = 60) -> StockKline:
        normalized = normalize_symbol(symbol)
        self.calls.append((normalized, days))
        if self.unavailable:
            raise KlineUnavailable("upstream response included a private diagnostic")
        return StockKline(
            symbol=normalized,
            name="贵州茅台",
            exchange="SSE",
            days=days,
            generated_at=datetime(2026, 7, 27, 8, 30, tzinfo=UTC),
            latest=KlineLatest(
                trade_date=date(2026, 7, 27),
                price=1500.0,
                change=10.0,
                change_pct=0.67,
                high=1510.0,
                low=1480.0,
                volume=120_000,
            ),
            bars=[
                KlineBar(
                    date=date(2026, 7, 27),
                    open=1490.0,
                    high=1510.0,
                    low=1480.0,
                    close=1500.0,
                    volume=120_000,
                    change_pct=0.67,
                    ma5=1495.0,
                    ma10=1488.0,
                    ma20=1476.0,
                )
            ],
        )


@pytest.mark.asyncio
async def test_kline_route_returns_normalized_daily_contract() -> None:
    service = FakeKlineService()
    response = await _get(service, "/api/v1/stocks/600519/kline", days=60)

    assert response.status_code == 200
    assert response.json()["adjustment"] == "qfq"
    assert response.json()["days"] == 60
    assert response.json()["bars"][-1]["date"] == "2026-07-27"
    assert response.headers["cache-control"] == "no-store"
    assert service.calls == [("600519", 60)]


@pytest.mark.asyncio
async def test_kline_route_rejects_unsupported_days_before_calling_service() -> None:
    service = FakeKlineService()
    response = await _get(service, "/api/v1/stocks/600519/kline", days=30)

    assert response.status_code == 422
    assert service.calls == []


@pytest.mark.asyncio
async def test_kline_route_maps_non_main_board_symbol_to_stable_error() -> None:
    service = FakeKlineService()
    response = await _get(service, "/api/v1/stocks/300750/kline", days=60)

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MAIN_BOARD_ONLY"


@pytest.mark.asyncio
async def test_kline_route_hides_upstream_failure_details() -> None:
    service = FakeKlineService(unavailable=True)
    response = await _get(service, "/api/v1/stocks/600519/kline", days=60)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "KLINE_UNAVAILABLE"
    assert "private diagnostic" not in response.text


async def _get(
    service: FakeKlineService,
    path: str,
    *,
    days: int,
) -> httpx.Response:
    application = create_app(kline_service=service)  # type: ignore[call-arg]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="http://test",
    ) as client:
        return await client.get(path, params={"days": days})
