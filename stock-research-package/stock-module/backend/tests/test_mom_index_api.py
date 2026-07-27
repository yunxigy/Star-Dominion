from datetime import UTC, date, datetime

import httpx
import pytest

from app.domain.mom_index import MomIndexSnapshot, MomSectorIndex, MomSourceStatus
from app.main import create_app
from tests.auth_helpers import AUTH_COOKIES, AuthenticatedSiteAuthClient


def snapshot() -> MomIndexSnapshot:
    return MomIndexSnapshot(
        snapshot_date=date(2026, 7, 27),
        generated_at=datetime(2026, 7, 27, 0, 30, tzinfo=UTC),
        completeness="partial",
        sectors={
            "nasdaq": MomSectorIndex(
                sector_id="nasdaq",
                name="纳斯达克",
                index=45,
                buy_index=30,
                sell_index=10,
                total_posts=10,
                valid_posts=10,
                newbie_posts=3,
                newbie_ratio=30,
                buy_count=2,
                sell_count=0,
                risk_level="warming",
                interpretation="开始升温",
                top_posts=[],
            )
        },
        sources=[
            MomSourceStatus(
                source_id="eastmoney",
                status="ok",
                collected_at=datetime(2026, 7, 27, 0, 20, tzinfo=UTC),
                post_count=10,
            )
        ],
    )


class FakeMomService:
    def current(self):
        return snapshot()

    def history(self, limit: int):
        return [snapshot()]


class FakeTask:
    def model_dump(self, **_):
        return {"task_id": "mom-1", "status": "queued"}


class FakeCoordinator:
    def start(self):
        return FakeTask()

    def get(self, task_id: str):
        return FakeTask() if task_id == "mom-1" else None

    def shutdown(self):
        return None


class FakeLogin:
    async def start(self):
        return {"session_id": "login-1", "qr_code": "data:image/png;base64,AA=="}

    async def poll(self, session_id: str):
        return {"session_id": session_id, "status": "succeeded"}

    async def status(self):
        return {"status": "authenticated"}


@pytest.mark.asyncio
async def test_public_reads_and_admin_controls() -> None:
    application = create_app(
        mom_index_service=FakeMomService(),
        mom_refresh_coordinator=FakeCoordinator(),
        xhs_login_service=FakeLogin(),
        site_auth_client=AuthenticatedSiteAuthClient(),
    )
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        current = await client.get("/api/v1/mom-index/current")
        history = await client.get("/api/v1/mom-index/history")
        denied = await client.post("/api/v1/mom-index/refresh")

    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies=AUTH_COOKIES,
    ) as admin:
        started = await admin.post("/api/v1/mom-index/refresh")
        login = await admin.post("/api/v1/mom-index/xhs/login")

    assert current.status_code == 200
    assert history.status_code == 200
    assert denied.status_code == 401
    assert started.status_code == 202
    assert login.status_code == 200

