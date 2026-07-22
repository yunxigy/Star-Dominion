from datetime import UTC, datetime

import httpx
import pytest

from app.domain.analysis_tasks import AnalysisTask
from app.main import create_app
from tests.auth_helpers import AUTH_COOKIES, AuthenticatedSiteAuthClient


class FakeAnalysisCoordinator:
    def __init__(self) -> None:
        self.created: list[object] = []
        self.task = AnalysisTask(
            task_id="analysis-1",
            owner_id="local",
            symbol="600519",
            profile_id="p1",
            profile_name="硅基流动",
            profile_scope="personal",
            model="m1",
            report_type="detailed",
            force_refresh=False,
            state="succeeded",
            progress_message="分析完成",
            report={"summary": "ok"},
            created_at=datetime(2026, 7, 21, tzinfo=UTC),
            updated_at=datetime(2026, 7, 21, tzinfo=UTC),
            finished_at=datetime(2026, 7, 21, tzinfo=UTC),
        )

    def start(self, request: object, **_: object) -> AnalysisTask:
        self.created.append(request)
        return self.task

    def get(self, task_id: str, **_: object) -> AnalysisTask | None:
        return self.task if task_id == self.task.task_id else None

    def shutdown(self) -> None:
        return None


class FakeProfiles:
    def list_available(self) -> list:
        return []


@pytest.mark.asyncio
async def test_analysis_routes_create_status_and_report() -> None:
    coordinator = FakeAnalysisCoordinator()
    app = create_app(analysis_coordinator=coordinator, model_profile_service=FakeProfiles(), site_auth_client=AuthenticatedSiteAuthClient())  # type: ignore[arg-type]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=AUTH_COOKIES) as client:
        created = await client.post(
            "/api/v1/analyses",
            json={"symbol": "600519", "profile_id": "p1", "model": "m1"},
        )
        status = await client.get("/api/v1/analyses/analysis-1")
        report = await client.get("/api/v1/analyses/analysis-1/report")
        missing = await client.get("/api/v1/analyses/missing")

    assert created.status_code == 202
    assert created.json()["model"] == "m1"
    assert "owner_id" not in created.json()
    assert status.status_code == 200
    assert report.status_code == 200
    assert report.json() == {"task_id": "analysis-1", "report": {"summary": "ok"}}
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_analysis_create_rejects_missing_model_and_non_main_board() -> None:
    app = create_app(analysis_coordinator=FakeAnalysisCoordinator(), model_profile_service=FakeProfiles(), site_auth_client=AuthenticatedSiteAuthClient())  # type: ignore[arg-type]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=AUTH_COOKIES) as client:
        missing_model = await client.post(
            "/api/v1/analyses", json={"symbol": "600519", "profile_id": "p1", "model": ""}
        )
        growth_board = await client.post(
            "/api/v1/analyses", json={"symbol": "300750", "profile_id": "p1", "model": "m1"}
        )

    assert missing_model.status_code == 422
    assert growth_board.status_code == 422


@pytest.mark.asyncio
async def test_report_is_not_available_before_success() -> None:
    coordinator = FakeAnalysisCoordinator()
    coordinator.task = coordinator.task.model_copy(update={"state": "analyzing", "report": None})
    app = create_app(analysis_coordinator=coordinator, model_profile_service=FakeProfiles(), site_auth_client=AuthenticatedSiteAuthClient())  # type: ignore[arg-type]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", cookies=AUTH_COOKIES) as client:
        response = await client.get("/api/v1/analyses/analysis-1/report")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "ANALYSIS_NOT_READY"
