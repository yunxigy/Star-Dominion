from datetime import date
from pathlib import Path

import pytest

from app.domain.candidates import CandidateSource, CandidateStock
from app.integrations.catalyst_reports import CatalystMorningReportAdapter
from app.repositories.morning_reports import MorningReportRepository
from app.services.candidate_refresh import CandidateCollection
from app.services.morning_reports import MorningReportService, MorningReportUnavailable


FIXTURE = Path(__file__).parent / "fixtures" / "catalyst-morning.json"


class StaticMorningSource:
    def __init__(self, report):
        self.report = report

    def load(self):
        return self.report


class FailingMorningSource:
    def load(self):
        raise RuntimeError("upstream unavailable")


def test_repository_keeps_history_and_returns_latest(tmp_path: Path) -> None:
    repository = MorningReportRepository(tmp_path / "hub.db")
    first = _report().model_copy(update={"report_date": date(2026, 7, 21)})
    second = _report()

    repository.save(first)
    repository.save(second)

    assert repository.latest() is not None
    assert repository.latest().report_date == date(2026, 7, 22)
    assert repository.get(date(2026, 7, 21)).report_date == date(2026, 7, 21)
    assert [item.report_date for item in repository.list_history()] == [
        date(2026, 7, 22),
        date(2026, 7, 21),
    ]


def test_failed_refresh_returns_latest_as_stale(tmp_path: Path) -> None:
    repository = MorningReportRepository(tmp_path / "hub.db")
    report = _report()
    repository.save(report)
    service = MorningReportService(repository, FailingMorningSource())

    result = service.refresh()

    assert result.freshness == "stale"
    assert result.previous_success_date == report.report_date
    assert result.catalyst_candidates[0].symbol == "000400"


def test_failed_refresh_without_history_raises_safe_error(tmp_path: Path) -> None:
    service = MorningReportService(
        MorningReportRepository(tmp_path / "hub.db"),
        FailingMorningSource(),
    )

    with pytest.raises(MorningReportUnavailable, match="尚无可用"):
        service.refresh()


def test_current_summary_limits_news_but_dated_report_keeps_all(tmp_path: Path) -> None:
    repository = MorningReportRepository(tmp_path / "hub.db")
    report = _report()
    repeated = [
        report.important_news[0].model_copy(update={"id": f"news-{index}", "title": f"消息 {index}"})
        for index in range(10)
    ]
    repository.save(report.model_copy(update={"important_news": repeated}))
    service = MorningReportService(repository, StaticMorningSource(report))

    assert len(service.current_summary().important_news) == 8
    assert len(service.get(report.report_date).important_news) == 10


def test_research_context_keeps_sources_separate(tmp_path: Path) -> None:
    report = _report()
    repository = MorningReportRepository(tmp_path / "hub.db")
    repository.save(report)
    service = MorningReportService(repository, StaticMorningSource(report))
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

    result = service.research_context("000400", CandidateCollection(items=[candidate]))

    assert result.cross_hit is True
    assert [source.source_id for source in result.sources] == ["catalyst", "user_strategy"]
    assert result.sources[0].score == 88.5
    assert result.sources[1].score == 76
    assert result.catalyst is not None
    assert result.catalyst.rationale == "海外电力资本开支映射"


def test_research_context_includes_small_cap_factors_without_changing_cross_hit(tmp_path: Path) -> None:
    report = _report()
    repository = MorningReportRepository(tmp_path / "hub.db")
    repository.save(report)
    service = MorningReportService(repository, StaticMorningSource(report))
    candidate = CandidateStock.create(
        symbol="000400",
        name="许继电气",
        source=CandidateSource(
            source_id="small_cap_absorption",
            source_name="小市值倍量吸筹",
            reasons=["首日倍量"],
            factors={
                "trigger_date": "2026-08-27",
                "volume_multiple": 2.4,
                "price_range_pct": 12.0,
                "max_drawdown_pct": 8.0,
                "first_volume_spike": True,
            },
        ),
    )

    result = service.research_context("000400", CandidateCollection(items=[candidate]))

    assert result.cross_hit is False
    evidence = next(item for item in result.sources if item.source_id == "small_cap_absorption")
    assert evidence.factors["trigger_date"] == "2026-08-27"
    assert evidence.factors["first_volume_spike"] is True


def test_valid_arbitrary_main_board_stock_returns_empty_context(tmp_path: Path) -> None:
    repository = MorningReportRepository(tmp_path / "hub.db")
    repository.save(_report())
    service = MorningReportService(repository, StaticMorningSource(_report()))

    result = service.research_context("600519", CandidateCollection())

    assert result.symbol == "600519"
    assert result.name == "600519"
    assert result.exchange == "SSE"
    assert result.cross_hit is False
    assert result.sources == []
    assert result.catalyst is None


def _report():
    return CatalystMorningReportAdapter(FIXTURE).load()
