from pathlib import Path

from fastapi.testclient import TestClient

from research_reports.collector.types import TrendingRepository
from research_reports.config import Settings
from research_reports.main import create_app
from research_reports.site_auth import SiteIdentity, SiteAuthRejected


class FixtureCollector:
    def fetch_trending(self, category: str):
        return [
            TrendingRepository(
                category=category,
                rank=1,
                full_name=f"owner/{category}-project",
                description=f"A {category} project",
                primary_language=None if category == "all" else category.title(),
                stars_total=1200,
                forks_total=80,
                stars_since_weekly=240,
                contributor_urls=(),
                html_url=f"https://github.com/owner/{category}-project",
            )
        ]


class FakeAuthClient:
    async def verify(self, *, session_token: str, **_):
        if session_token == "admin-token":
            return SiteIdentity(
                id="admin-id",
                email="admin@local.invalid",
                username="admin",
                role="admin",
                is_active=True,
            )
        if session_token == "user-token":
            return SiteIdentity(
                id="user-id",
                email="user@local.invalid",
                username="user",
                role="user",
                is_active=True,
            )
        raise SiteAuthRejected(401)


def _settings(tmp_path: Path) -> Settings:
    return Settings.from_env(
        {
            "RESEARCH_REPORTS_DATA_DIR": str(tmp_path),
            "RESEARCH_REPORTS_TIMEZONE": "Asia/Shanghai",
            "RESEARCH_REPORTS_SITE_AUTH_URL": "http://site-auth.test",
            "SITE_AUTH_INTERNAL_KEY": "k" * 32,
        }
    )


def _application(tmp_path: Path, executor=lambda job: job()):
    return create_app(
        settings=_settings(tmp_path),
        collector=FixtureCollector(),
        auth_client=FakeAuthClient(),
        start_scheduler=False,
        executor=executor,
    )


def test_public_rankings_do_not_require_login(tmp_path: Path) -> None:
    app = _application(tmp_path)
    with TestClient(app) as client:
        app.state.collection_service.collect_all(
            trigger="scheduled_hourly",
            requested_by=None,
        )
        issue = client.get("/api/v1/issues/current")
        response = client.get(
            f"/api/v1/issues/{issue.json()['id']}/rankings?category=python"
        )

    assert issue.status_code == 200
    assert response.status_code == 200
    payload = response.json()
    assert payload["category"] == "python"
    assert payload["items"][0]["fullName"] == "owner/python-project"
    assert payload["items"][0]["status"] == "new"


def test_manual_collection_requires_admin(tmp_path: Path) -> None:
    app = _application(tmp_path)
    with TestClient(app) as client:
        anonymous = client.post("/api/v1/admin/collections")
        client.cookies.set("sd_session", "user-token")
        client.cookies.set("sd_csrf", "csrf")
        user = client.post(
            "/api/v1/admin/collections",
            headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": "csrf"},
        )
        client.cookies.set("sd_session", "admin-token")
        admin = client.post(
            "/api/v1/admin/collections",
            headers={"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": "csrf"},
        )

    assert anonymous.status_code == 401
    assert user.status_code == 403
    assert admin.status_code == 202
    assert admin.json()["status"] == "running"


def test_overlapping_manual_collection_returns_conflict(tmp_path: Path) -> None:
    pending = []
    app = _application(tmp_path, executor=pending.append)
    with TestClient(app) as client:
        client.cookies.set("sd_session", "admin-token")
        client.cookies.set("sd_csrf", "csrf")
        headers = {"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": "csrf"}
        first = client.post("/api/v1/admin/collections", headers=headers)
        second = client.post("/api/v1/admin/collections", headers=headers)

    assert first.status_code == 202
    assert second.status_code == 409
