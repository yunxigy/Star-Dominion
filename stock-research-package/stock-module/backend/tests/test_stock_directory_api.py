from datetime import UTC, datetime

import httpx
import pytest

from app.main import create_app
from app.repositories.stock_directory import StockDirectoryEntry, StockDirectoryRepository
from app.services.stock_directory import StockDirectory


@pytest.mark.asyncio
async def test_search_uses_persisted_directory_and_returns_metadata(tmp_path) -> None:
    repository = StockDirectoryRepository(tmp_path / "hub.db", minimum_count=1)
    repository.replace(
        [
            StockDirectoryEntry(
                symbol="600519",
                name="贵州茅台",
                exchange="SSE",
                initials="gzmt",
            )
        ],
        source="akshare_code_name",
        generated_at=datetime(2026, 7, 27, tzinfo=UTC),
    )
    application = create_app(stock_directory=StockDirectory(repository))

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/stocks/search", params={"q": "gzmt"})

    assert response.status_code == 200
    assert response.json()["items"][0]["symbol"] == "600519"
    assert response.json()["directory"]["source"] == "akshare_code_name"
    assert response.json()["directory"]["count"] == 1
