"""Normalize the native CatDesk 9 report without modifying the upstream project."""

from datetime import UTC, date, datetime, timedelta
import json
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.domain.morning_reports import CandidateEvidence, MorningReport, ThemeSignal
from app.domain.stocks import InvalidMainBoardSymbol, exchange_for, normalize_symbol
from app.services.news_window import NewsSeed, build_important_news, trading_news_window


CN = ZoneInfo("Asia/Shanghai")


class CatalystReportError(RuntimeError):
    """The upstream report could not be normalized safely."""


class CatalystMorningReportAdapter:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def load(self) -> MorningReport:
        raw = _read_json(_latest_report(self._path))
        report = raw.get("result", raw)
        if not isinstance(report, dict) or not isinstance(report.get("themes"), list):
            raise CatalystReportError("九点猫研快照结构错误：缺少 themes")

        generated_at = _parse_datetime(report.get("generated_at"))
        report_date = _parse_date(report.get("date")) or generated_at.astimezone(CN).date()
        previous_trade_date = _previous_trade_date(report, report_date)
        themes = _theme_signals(report["themes"])
        candidates, seeds = _candidate_evidence(report["themes"])
        news_start, news_end = trading_news_window(
            report_date=report_date,
            previous_trade_date=previous_trade_date,
            now=generated_at,
        )
        important_news = build_important_news(seeds=seeds, start=news_start, end=news_end)
        news_by_symbol = {
            candidate.symbol: [item for item in important_news if candidate.symbol in item.symbols]
            for candidate in candidates
        }
        candidates = [
            candidate.model_copy(update={"news": news_by_symbol[candidate.symbol]})
            for candidate in candidates
        ]
        market_summary = "；".join(
            f"{theme.name}：{theme.summary or '暂无隔夜信号摘要'}（信号 {theme.signal_score:.1f}）"
            for theme in themes[:6]
        )
        return MorningReport(
            report_date=report_date,
            generated_at=generated_at,
            previous_trade_date=previous_trade_date,
            market_summary=market_summary,
            themes=themes,
            important_news=important_news,
            catalyst_candidates=candidates,
        )


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise CatalystReportError(f"候选快照不存在：{path.name}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CatalystReportError(f"无法解析候选快照：{path.name}") from exc
    if not isinstance(raw, dict):
        raise CatalystReportError(f"九点猫研快照结构错误：{path.name}")
    return raw


def _latest_report(path: Path) -> Path:
    if not path.is_dir():
        return path
    reports = sorted(path.glob("*-morning.json"))
    if not reports:
        raise CatalystReportError(f"候选快照不存在：{path.name}")
    return reports[-1]


def _parse_datetime(value: Any) -> datetime:
    if not value:
        return datetime.now(UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise CatalystReportError("九点猫研快照 generated_at 无效") from exc
    return parsed.replace(tzinfo=CN) if parsed.tzinfo is None else parsed


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _previous_trade_date(report: dict[str, Any], report_date: date) -> date:
    dates: list[date] = []
    for block in report.get("themes", []):
        if not isinstance(block, dict):
            continue
        for row in block.get("top", []):
            if not isinstance(row, dict):
                continue
            for point in row.get("kline", []):
                if not isinstance(point, dict):
                    continue
                parsed = _parse_date(point.get("date"))
                if parsed is not None and parsed < report_date:
                    dates.append(parsed)
    if dates:
        return max(dates)
    previous = report_date - timedelta(days=1)
    while previous.weekday() >= 5:
        previous -= timedelta(days=1)
    return previous


def _theme_signals(raw_themes: list[Any]) -> list[ThemeSignal]:
    themes: list[ThemeSignal] = []
    for block in raw_themes:
        if not isinstance(block, dict):
            continue
        theme = block.get("theme") if isinstance(block.get("theme"), dict) else {}
        signal = block.get("signal") if isinstance(block.get("signal"), dict) else {}
        name = str(theme.get("name") or theme.get("id") or "未命名主题").strip()
        themes.append(
            ThemeSignal(
                id=str(theme.get("id") or name),
                name=name,
                logic=str(theme.get("logic") or "").strip(),
                average_change_pct=_number(signal.get("avg_pct")),
                signal_score=_number(signal.get("score")),
                breadth=_number(signal.get("breadth")),
                summary=str(signal.get("summary") or "").strip(),
            )
        )
    return sorted(themes, key=lambda item: (-item.signal_score, item.name))


def _candidate_evidence(raw_themes: list[Any]) -> tuple[list[CandidateEvidence], list[NewsSeed]]:
    collected: dict[str, CandidateEvidence] = {}
    seeds: list[NewsSeed] = []
    for block in raw_themes:
        if not isinstance(block, dict):
            continue
        theme = block.get("theme") if isinstance(block.get("theme"), dict) else {}
        signal = block.get("signal") if isinstance(block.get("signal"), dict) else {}
        theme_name = str(theme.get("name") or theme.get("id") or "未命名主题").strip()
        theme_score = _number(signal.get("score"))
        for row in block.get("top", []):
            if not isinstance(row, dict) or not isinstance(row.get("candidate"), dict):
                continue
            candidate = row["candidate"]
            try:
                symbol = normalize_symbol(str(candidate.get("code", "")))
            except InvalidMainBoardSymbol:
                continue
            analyst = row.get("analyst") if isinstance(row.get("analyst"), dict) else {}
            dimensions = analyst.get("dimensions") if isinstance(analyst.get("dimensions"), dict) else {}
            evidence = CandidateEvidence(
                symbol=symbol,
                name=str(candidate.get("name") or symbol).strip(),
                exchange=exchange_for(symbol),
                industry=str(candidate.get("industry") or "").strip(),
                theme=theme_name,
                total_score=_number(row.get("score")),
                rationale=str(candidate.get("rationale") or "").strip(),
                dimension_scores=_number_dict(dimensions),
                historical_stats=_public_stats(row.get("stats")),
                positive_flags=_text_list(row.get("news_hits")),
                risk_flags=_text_list(row.get("news_risks")),
                invalid_conditions=_text_list(analyst.get("invalid_conditions"))
                or _text_list(row.get("invalid_conditions")),
            )
            existing = collected.get(symbol)
            if existing is None or evidence.total_score > existing.total_score:
                collected[symbol] = evidence
            for item in row.get("news", []):
                if not isinstance(item, dict):
                    continue
                seeds.append(
                    NewsSeed(
                        title=str(item.get("title") or ""),
                        published_at=str(item.get("time") or item.get("date") or ""),
                        source=str(item.get("source") or ""),
                        url=str(item.get("url") or item.get("link") or ""),
                        symbol=symbol,
                        theme=theme_name,
                        theme_score=theme_score,
                    )
                )
    candidates = sorted(collected.values(), key=lambda item: (-item.total_score, item.symbol))
    return candidates, seeds


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _number_dict(value: dict[str, Any]) -> dict[str, float]:
    return {str(key): _number(item) for key, item in value.items()}


def _public_stats(value: Any) -> dict[str, float | int | str | None]:
    if not isinstance(value, dict):
        return {}
    allowed = (float, int, str, type(None))
    return {str(key): item for key, item in value.items() if isinstance(item, allowed)}


def _text_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]
