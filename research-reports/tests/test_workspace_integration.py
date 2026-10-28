import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_workspace_runs_and_proxies_research_reports() -> None:
    platform = ROOT / "平台管理"
    start = (platform / "scripts/start-local.ps1").read_text(encoding="utf-8")
    check = (platform / "scripts/check-local.ps1").read_text(encoding="utf-8")
    manifest = json.loads((platform / "scripts/local-services.json").read_text(encoding="utf-8"))
    vite = (ROOT / "SD/vite.config.ts").read_text(encoding="utf-8")
    nginx = (platform / "nginx.conf").read_text(encoding="utf-8")

    assert "Get-LocalServiceManifest" in start
    reports = next(service for service in manifest["services"] if service["name"] == "research-reports")
    assert reports["ports"] == [8009]
    assert "Get-LocalServiceManifest" in check
    assert "'/reports-api'" in vite
    assert "location ^~ /reports-api/" in nginx
    assert "proxy_pass http://127.0.0.1:8009/;" in nginx
