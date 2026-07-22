"""Adapters from external candidate snapshots into the stock hub domain."""

from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from app.domain.candidates import CandidateSource, CandidateStock
from app.domain.stocks import InvalidMainBoardSymbol
from app.domain.strategies import StockSeries, evaluate_stock_strategies
from app.integrations.catalyst_reports import CatalystMorningReportAdapter, CatalystReportError


class CandidateSourceError(RuntimeError):
    """A candidate source could not provide a trustworthy snapshot."""


class CandidateBatch(BaseModel):
    source_id: str
    generated_at: datetime
    items: list[CandidateStock]


class CandidateProvider(Protocol):
    source_id: str
    source_name: str

    def load(self) -> CandidateBatch: ...


class CatalystReportSource:
    source_id = "catalyst"
    source_name = "九点猫研"

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def load(self) -> CandidateBatch:
        try:
            report = CatalystMorningReportAdapter(self._path).load()
        except CatalystReportError as exc:
            raise CandidateSourceError(str(exc)) from exc
        items: list[CandidateStock] = []
        for evidence in report.catalyst_candidates:
            reasons = [f"主题：{evidence.theme}"]
            if evidence.rationale:
                reasons.append(evidence.rationale)
            reasons.extend(flag for flag in evidence.positive_flags if flag not in reasons)
            item = CandidateStock.create(
                symbol=evidence.symbol,
                name=evidence.name,
                source=CandidateSource(
                    source_id=self.source_id,
                    source_name=self.source_name,
                    score=evidence.total_score,
                    reasons=reasons,
                ),
            )
            item.generated_at = report.generated_at
            items.append(item)
        return CandidateBatch(
            source_id=self.source_id,
            generated_at=report.generated_at,
            items=sorted(items, key=lambda item: item.stock.symbol),
        )


class UserStrategySnapshotSource:
    source_id = "user_strategy"
    source_name = "用户策略"

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def load(self) -> CandidateBatch:
        raw = _read_json(self._path)
        if not isinstance(raw.get("stocks"), list):
            raise CandidateSourceError("用户策略快照结构错误：缺少 stocks")
        generated_at = _parse_datetime(raw.get("generated_at"))
        items: list[CandidateStock] = []

        for row in raw["stocks"]:
            if not isinstance(row, dict):
                continue
            try:
                stock = StockSeries.model_validate(row)
            except ValidationError as exc:
                raise CandidateSourceError("用户策略快照结构错误：股票 K 线字段无效") from exc
            matched = [result for result in evaluate_stock_strategies(stock) if result.matched]
            if not matched:
                continue
            reasons = [f"{result.strategy_name}：{reason}" for result in matched for reason in result.reasons]
            reasons.extend(f"题材：{concept}" for concept in stock.concepts if concept)
            try:
                item = CandidateStock.create(
                    symbol=stock.symbol,
                    name=stock.name,
                    source=CandidateSource(
                        source_id=self.source_id,
                        source_name=self.source_name,
                        score=max(result.score for result in matched),
                        reasons=reasons,
                    ),
                )
            except InvalidMainBoardSymbol:
                continue
            item.generated_at = generated_at
            items.append(item)

        return CandidateBatch(source_id=self.source_id, generated_at=generated_at, items=items)


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise CandidateSourceError(f"候选快照不存在：{path.name}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CandidateSourceError(f"无法解析候选快照：{path.name}") from exc
    if not isinstance(raw, dict):
        raise CandidateSourceError(f"候选快照结构错误：{path.name}")
    return raw


def _latest_catalyst_report(path: Path) -> Path:
    if not path.is_dir():
        return path
    reports = sorted(path.glob("*-morning.json"))
    if not reports:
        raise CandidateSourceError(f"候选快照不存在：{path.name}")
    return reports[-1]


def _parse_datetime(value: Any) -> datetime:
    if not value:
        return datetime.now(UTC)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise CandidateSourceError("候选快照 generated_at 无效") from exc


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
