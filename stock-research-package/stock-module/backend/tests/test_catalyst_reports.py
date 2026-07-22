from pathlib import Path

from app.integrations.catalyst_reports import CatalystMorningReportAdapter


FIXTURE = Path(__file__).parent / "fixtures" / "catalyst-morning.json"


def test_adapter_preserves_full_nine_o_clock_research() -> None:
    report = CatalystMorningReportAdapter(FIXTURE).load()

    assert report.report_date.isoformat() == "2026-07-22"
    assert report.previous_trade_date.isoformat() == "2026-07-21"
    assert report.themes[0].name == "电网设备"
    assert report.themes[0].signal_score == 82.0
    assert [item.symbol for item in report.catalyst_candidates] == ["000400"]
    item = report.catalyst_candidates[0]
    assert item.exchange == "SZSE"
    assert item.rationale == "海外电力资本开支映射"
    assert item.dimension_scores["history_edge"] == 73.0
    assert item.historical_stats["win_rate"] == 0.68
    assert item.risk_flags == ["解禁"]
    assert item.invalid_conditions == ["高开超过 7%"]


def test_adapter_builds_overnight_news_from_candidate_rows() -> None:
    report = CatalystMorningReportAdapter(FIXTURE).load()

    assert len(report.important_news) == 1
    assert report.important_news[0].title == "许继电气中标重大项目"
    assert report.important_news[0].symbols == ["000400"]
    assert report.important_news[0].themes == ["电网设备"]
    assert [item.title for item in report.catalyst_candidates[0].news] == ["许继电气中标重大项目"]


def test_adapter_builds_readable_market_summary() -> None:
    report = CatalystMorningReportAdapter(FIXTURE).load()

    assert report.market_summary == "电网设备：海外电力设备主题走强（信号 82.0）"
