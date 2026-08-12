from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_workspace_runs_and_proxies_research_reports() -> None:
    start = (ROOT / "scripts/start-local.ps1").read_text(encoding="utf-8")
    check = (ROOT / "scripts/check-local.ps1").read_text(encoding="utf-8")
    manifest = (ROOT / "scripts/local-services.json").read_text(encoding="utf-8")
    vite = (ROOT / "SD/vite.config.ts").read_text(encoding="utf-8")

    assert "Get-LocalServiceManifest" in start
    assert '"name":"research-reports"' in manifest
    assert '"ports":[8009]' in manifest
    assert "Get-LocalServiceManifest" in check
    assert "'/reports-api'" in vite
