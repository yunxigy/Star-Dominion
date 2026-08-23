from httpx import ASGITransport, AsyncClient

from video_downloader.app import create_app
from video_downloader.dependencies import DependencyStatus


class FakeDependencyProbe:
    def status(self) -> DependencyStatus:
        return DependencyStatus(
            yt_dlp=True,
            ffmpeg=False,
            douyin_cookie="missing",
        )


async def test_health_reports_degraded_capabilities_without_paths(settings):
    app = create_app(settings=settings, dependency_probe=FakeDependencyProbe())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "degraded",
        "capabilities": {
            "ytDlp": True,
            "ffmpeg": False,
            "douyinCookie": "missing",
        },
    }
    body = response.text.lower()
    assert "cookie_file" not in body
    assert str(settings.temp_dir).lower() not in body
