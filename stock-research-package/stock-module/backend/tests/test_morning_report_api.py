from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.domain.candidates import CandidateSource, CandidateStock
from app.integrations.catalyst_reports import CatalystMorningReportAdapter
from app.main import create_app
from app.repositories.morning_reports import MorningReportRepository
from app.repositories.refresh_tasks import RefreshTask
from app.services.candidate_refresh import CandidateCollection
from app.services.morning_reports import MorningReportService
from tests.auth_helpers import AUTH_COOKIES, AuthenticatedSiteAuthClient


FIXTURE = Path(__file__).parent / "fixtures" / "catalyst-morning.json"


class FakeCandidateService:
    def __init__(self, collection: CandidateCollection) -> None:
        self.collection = collection

    def get_candidates(self) -> CandidateCollection:
        return self.collection


class FakeRefreshCoordinator:
    def __init__(self) -> None:
        self.task = RefreshTask(
            task_id="refresh-morning",
            status="queued",
            created_at=datetime(2026, 7, 22, 9, 0, tzinfo=UTC),
        )

    def start(self) -> RefreshTask:
        return self.task

    def get(self, task_id: str) -> RefreshTask | None:
        return self.task if task_id == self.task.task_id else None

    def shutdown(self) -> None:
        return None


class FakeProfiles:
    def list_available(self) -> list:
        return []


class FakeAnalyses:
    def shutdown(self) -> None:
        return None


@pytest.fixture
def morning_service(tmp_path: Path) -> MorningReportService:
    report = CatalystMorningReportAdapter(FIXTURE).load()
    repository = MorningReportRepository(tmp_path / "hub.db")
    repository.save(report)
    return MorningReportService(repository, CatalystMorningReportAdapter(FIXTURE))


@pytest.fixture
def candidate_service() -> FakeCandidateService:
    candidate = CandidateStock.create(
        symbol="000400",
        name="许继电气",
        source=CandidateSource(
            source_id="catalyst",
            source_name="九点猫研",
            score=88.5,
            reasons=["主题：电网设备"],
        ),
    )
    candidate.sources.append(
        CandidateSource(
            source_id="user_strategy",
            source_name="我的选股策略",
            score=76,
            reasons=["低位放量"],
        )
    )
    return FakeCandidateService(CandidateCollection(items=[candidate]))


@pytest.mark.asyncio
async def test_morning_report_routes_expose_summary_history_and_full_report(
    morning_service: MorningReportService,
    candidate_service: FakeCandidateService,
) -> None:
    app = _app(morning_service, candidate_service)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=AUTH_COOKIES) as client:
        current = await client.get("/api/v1/morning-report/current")
        history = await client.get("/api/v1/morning-reports", params={"limit": 20})
        full = await client.get("/api/v1/morning-reports/2026-07-22")

    assert current.status_code == 200
    assert current.json()["themes"][0]["name"] == "电网设备"
    assert current.json()["catalyst_candidates"][0]["symbol"] == "000400"
    assert len(current.json()["important_news"]) <= 8
    assert history.status_code == 200
    assert history.json()["items"][0]["report_date"] == "2026-07-22"
    assert full.status_code == 200
    assert full.json()["report_date"] == "2026-07-22"


@pytest.mark.asyncio
async def test_research_context_supports_cross_hit_and_arbitrary_main_board(
    morning_service: MorningReportService,
    candidate_service: FakeCandidateService,
) -> None:
    app = _app(morning_service, candidate_service)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=AUTH_COOKIES) as client:
        cross_hit = await client.get("/api/v1/stocks/000400/research-context")
        arbitrary = await client.get("/api/v1/stocks/600519/research-context")
        excluded = await client.get("/api/v1/stocks/300750/research-context")

    assert cross_hit.status_code == 200
    assert cross_hit.json()["cross_hit"] is True
    assert [item["source_id"] for item in cross_hit.json()["sources"]] == ["catalyst", "user_strategy"]
    assert arbitrary.status_code == 200
    assert arbitrary.json()["symbol"] == "600519"
    assert arbitrary.json()["sources"] == []
    assert excluded.status_code == 422
    assert excluded.json()["detail"]["code"] == "MAIN_BOARD_ONLY"


@pytest.mark.asyncio
async def test_refresh_alias_reuses_candidate_refresh_task(
    morning_service: MorningReportService,
    candidate_service: FakeCandidateService,
) -> None:
    app = _app(morning_service, candidate_service)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=AUTH_COOKIES) as client:
        response = await client.post("/api/v1/morning-report/refresh")

    assert response.status_code == 202
    assert response.json()["task_id"] == "refresh-morning"


def _app(morning_service: MorningReportService, candidate_service: FakeCandidateService):
    return create_app(
        candidate_service=candidate_service,  # type: ignore[arg-type]
        refresh_coordinator=FakeRefreshCoordinator(),  # type: ignore[arg-type]
        morning_report_service=morning_service,
        model_profile_service=FakeProfiles(),  # type: ignore[arg-type]
        analysis_coordinator=FakeAnalyses(),  # type: ignore[arg-type]
        site_auth_client=AuthenticatedSiteAuthClient(),  # type: ignore[arg-type]
    )
