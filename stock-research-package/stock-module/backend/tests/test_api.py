from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.domain.candidates import CandidateSource, CandidateStock
from app.config import Settings
from app.integrations.candidate_sources import CandidateBatch
from app.main import app, create_app
from app.repositories.candidate_snapshots import CandidateSnapshotRepository
from app.repositories.refresh_tasks import RefreshTask
from app.services.candidate_refresh import CandidateRefreshService
from app.services.stock_directory import InMemoryStockDirectory, StockRecord
from tests.auth_helpers import AUTH_COOKIES, AuthenticatedSiteAuthClient


class ApiFakeSource:
    def __init__(self, source_id: str, source_name: str, batch: CandidateBatch) -> None:
        self.source_id = source_id
        self.source_name = source_name
        self.batch = batch

    def load(self) -> CandidateBatch:
        return self.batch


class ApiFakeCoordinator:
    def __init__(self) -> None:
        self.task = RefreshTask(
            task_id="refresh-1",
            status="queued",
            created_at=datetime(2026, 7, 21, 9, 0, tzinfo=UTC),
        )

    def start(self) -> RefreshTask:
        return self.task

    def get(self, task_id: str) -> RefreshTask | None:
        return self.task if task_id == self.task.task_id else None

    def shutdown(self) -> None:
        return None


def test_settings_read_candidate_paths_from_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("STOCK_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("CATALYST_REPORT_PATH", str(tmp_path / "cat.json"))
    monkeypatch.setenv("USER_STRATEGY_SNAPSHOT_PATH", str(tmp_path / "strategy.json"))

    settings = Settings.from_env()

    assert settings.data_dir == tmp_path / "data"
    assert settings.catalyst_report_path == tmp_path / "cat.json"
    assert settings.user_strategy_snapshot_path == tmp_path / "strategy.json"


def test_directory_searches_by_code_and_name_and_excludes_other_boards() -> None:
    directory = InMemoryStockDirectory(
        [
            StockRecord(symbol="600519", name="贵州茅台"),
            StockRecord(symbol="000001", name="平安银行"),
            StockRecord(symbol="300750", name="宁德时代"),
        ]
    )

    assert [item.symbol for item in directory.search("茅台")] == ["600519"]
    assert [item.symbol for item in directory.search("000")] == ["000001"]
    assert directory.search("宁德") == []


def test_directory_returns_empty_for_blank_query() -> None:
    directory = InMemoryStockDirectory([StockRecord(symbol="600519", name="贵州茅台")])

    assert directory.search("   ") == []


@pytest.mark.asyncio
async def test_health_reports_service_name() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["service"] == "stock-hub"
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_search_returns_main_board_matches() -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/stocks/search", params={"q": "茅台"})

    assert response.status_code == 200
    assert response.json()["items"][0]["symbol"] == "600519"


@pytest.mark.asyncio
async def test_new_repository_returns_no_demo_candidates(tmp_path: Path) -> None:
    service = CandidateRefreshService(CandidateSnapshotRepository(tmp_path / "hub.db"), [])
    isolated_app = create_app(candidate_service=service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=isolated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/candidates")

    assert response.status_code == 200
    assert response.json() == {"items": [], "sources": []}


@pytest.mark.asyncio
async def test_refresh_then_get_preserves_multiple_sources_for_same_stock(tmp_path: Path) -> None:
    catalyst = ApiFakeSource("catalyst", "九点猫研", _api_batch("catalyst", "九点猫研"))
    strategy = ApiFakeSource("user_strategy", "用户策略", _api_batch("user_strategy", "用户策略"))
    service = CandidateRefreshService(CandidateSnapshotRepository(tmp_path / "hub.db"), [catalyst, strategy])
    service.refresh()
    isolated_app = create_app(candidate_service=service)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=isolated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/candidates")

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert {source["source_id"] for source in item["sources"]} == {
        "catalyst",
        "user_strategy",
    }
    assert {source["status"] for source in response.json()["sources"]} == {"ok"}


@pytest.mark.asyncio
async def test_refresh_api_returns_accepted_task_and_supports_status_lookup(tmp_path: Path) -> None:
    service = CandidateRefreshService(CandidateSnapshotRepository(tmp_path / "hub.db"), [])
    coordinator = ApiFakeCoordinator()
    isolated_app = create_app(candidate_service=service, refresh_coordinator=coordinator, site_auth_client=AuthenticatedSiteAuthClient())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=isolated_app),
        base_url="http://test",
        cookies=AUTH_COOKIES,
    ) as client:
        started = await client.post("/api/v1/candidates/refresh")
        status = await client.get("/api/v1/candidates/refresh/refresh-1")
        missing = await client.get("/api/v1/candidates/refresh/missing")

    assert started.status_code == 202
    assert started.json()["task_id"] == "refresh-1"
    assert started.json()["status"] == "queued"
    assert status.status_code == 200
    assert missing.status_code == 404


def _api_batch(source_id: str, source_name: str) -> CandidateBatch:
    generated_at = datetime(2026, 7, 21, 8, 0, tzinfo=UTC)
    item = CandidateStock.create(
        symbol="600001",
        name="接口示例",
        source=CandidateSource(
            source_id=source_id,
            source_name=source_name,
            reasons=["真实快照测试"],
        ),
    )
    item.generated_at = generated_at
    return CandidateBatch(source_id=source_id, generated_at=generated_at, items=[item])
