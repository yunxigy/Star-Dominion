"""Morning report refresh, stale fallback and per-stock research aggregation."""

from datetime import date
from typing import Protocol

from app.domain.morning_reports import (
    MorningReport,
    MorningReportHistoryResponse,
    ResearchSourceEvidence,
    StockResearchContext,
)
from app.domain.stocks import exchange_for, normalize_symbol
from app.repositories.morning_reports import MorningReportRepository
from app.services.candidate_refresh import CandidateCollection


class MorningReportSource(Protocol):
    def load(self) -> MorningReport: ...


class MorningReportUnavailable(RuntimeError):
    pass


class MorningReportService:
    def __init__(
        self,
        repository: MorningReportRepository,
        source: MorningReportSource,
    ) -> None:
        self._repository = repository
        self._source = source

    def refresh(self) -> MorningReport:
        try:
            report = self._source.load()
        except Exception as exc:
            previous = self._repository.latest()
            if previous is None:
                raise MorningReportUnavailable("尚无可用的九点猫研晨报") from exc
            return previous.model_copy(
                update={
                    "freshness": "stale",
                    "previous_success_date": previous.report_date,
                }
            )
        self._repository.save(report)
        return report

    def current_summary(self) -> MorningReport:
        report = self._repository.latest()
        if report is None:
            raise MorningReportUnavailable("尚无可用的九点猫研晨报")
        return report.model_copy(update={"important_news": report.important_news[:8]})

    def get(self, report_date: date) -> MorningReport | None:
        return self._repository.get(report_date)

    def history(self, limit: int = 20) -> MorningReportHistoryResponse:
        return MorningReportHistoryResponse(items=self._repository.list_history(limit))

    def research_context(
        self,
        symbol: str,
        candidates: CandidateCollection,
    ) -> StockResearchContext:
        normalized = normalize_symbol(symbol)
        report = self._repository.latest()
        catalyst = next(
            (
                item
                for item in report.catalyst_candidates
                if item.symbol == normalized
            ),
            None,
        ) if report else None
        candidate = next(
            (item for item in candidates.items if item.stock.symbol == normalized),
            None,
        )
        sources: list[ResearchSourceEvidence] = []
        if candidate is not None:
            ordered = sorted(
                candidate.sources,
                key=lambda item: 0 if item.source_id == "catalyst" else 1,
            )
            for source in ordered:
                if source.source_id not in {"catalyst", "user_strategy"}:
                    continue
                sources.append(
                    ResearchSourceEvidence(
                        source_id=source.source_id,
                        source_name=source.source_name,
                        score=source.score,
                        reasons=source.reasons,
                    )
                )
        source_ids = {source.source_id for source in sources}
        name = (
            candidate.stock.name
            if candidate is not None
            else catalyst.name
            if catalyst is not None
            else normalized
        )
        return StockResearchContext(
            symbol=normalized,
            name=name,
            exchange=exchange_for(normalized),
            cross_hit={"catalyst", "user_strategy"}.issubset(source_ids),
            sources=sources,
            catalyst=catalyst,
        )
