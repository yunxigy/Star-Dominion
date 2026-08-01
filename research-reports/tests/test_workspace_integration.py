from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_workspace_runs_and_proxies_research_reports() -> None:
    start = (ROOT / "scripts/start-local.ps1").read_text(encoding="utf-8")
    check = (ROOT / "scripts/check-local.ps1").read_text(encoding="utf-8")
    vite = (ROOT / "SD/vite.config.ts").read_text(encoding="utf-8")

    assert "Name='research-reports'" in start
    assert "Ports=@(8009)" in start
    assert "8000..8009" in check
    assert "'/reports-api'" in vite
