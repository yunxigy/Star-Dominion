"""Deterministic overnight-news filtering, deduplication and ranking."""

from dataclasses import dataclass
from datetime import date, datetime, time
import hashlib
import re
from zoneinfo import ZoneInfo

from app.domain.morning_reports import ImportantNewsItem


CN = ZoneInfo("Asia/Shanghai")
POSITIVE_WORDS = ("中标", "订单", "增长", "预增", "回购", "合作", "突破", "量产", "扩产", "获批")
RISK_WORDS = ("减持", "亏损", "处罚", "问询", "立案", "诉讼", "终止", "解禁", "风险")


@dataclass(frozen=True)
class NewsSeed:
    title: str
    published_at: str | datetime
    source: str
    url: str = ""
    symbol: str = ""
    theme: str = ""
    theme_score: float = 0


def trading_news_window(
    *,
    report_date: date,
    previous_trade_date: date,
    now: datetime,
) -> tuple[datetime, datetime]:
    start = datetime.combine(previous_trade_date, time(15, 0), CN)
    scheduled_open = datetime.combine(report_date, time(9, 30), CN)
    localized_now = now.replace(tzinfo=CN) if now.tzinfo is None else now.astimezone(CN)
    return start, min(localized_now, scheduled_open)


def build_important_news(
    *,
    seeds: list[NewsSeed],
    start: datetime,
    end: datetime,
) -> list[ImportantNewsItem]:
    grouped: dict[str, list[tuple[NewsSeed, datetime]]] = {}
    for seed in seeds:
        title = seed.title.strip()
        published_at = _parse_news_time(seed.published_at)
        if not title or published_at is None or not start <= published_at <= end:
            continue
        key = _normalized_title(title)
        if not key:
            continue
        grouped.setdefault(key, []).append((seed, published_at))

    items: list[ImportantNewsItem] = []
    for key, records in grouped.items():
        best_seed, _ = max(records, key=lambda record: (_source_weight(record[0].source), record[1]))
        published_at = max(record[1] for record in records)
        symbols = sorted({record[0].symbol.strip() for record in records if record[0].symbol.strip()})
        themes = sorted({record[0].theme.strip() for record in records if record[0].theme.strip()})
        theme_scores = [record[0].theme_score for record in records]
        positive_hits = [word for word in POSITIVE_WORDS if word in best_seed.title]
        risk_hits = [word for word in RISK_WORDS if word in best_seed.title]
        tone = "risk" if risk_hits else "positive" if positive_hits else "neutral"
        score = (
            _source_weight(best_seed.source)
            + min(len(symbols), 5) * 5
            + min(max(theme_scores, default=0), 100) * 0.20
            + _keyword_weight(positive_hits, risk_hits)
            + _recency_weight(published_at, end)
        )
        items.append(
            ImportantNewsItem(
                id=hashlib.sha256(key.encode("utf-8")).hexdigest()[:16],
                title=best_seed.title.strip(),
                summary=_summary(symbols, themes, positive_hits, risk_hits, best_seed.title.strip()),
                published_at=published_at,
                source=best_seed.source.strip() or "公开信息",
                url=best_seed.url.strip(),
                themes=themes,
                symbols=symbols,
                importance_score=round(score, 2),
                tone=tone,
            )
        )
    return sorted(items, key=lambda item: (-item.importance_score, -item.published_at.timestamp(), item.title))


def _parse_news_time(value: str | datetime) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            parsed = None
            for pattern in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
                try:
                    parsed = datetime.strptime(text, pattern)
                    break
                except ValueError:
                    continue
            if parsed is None:
                return None
    return parsed.replace(tzinfo=CN) if parsed.tzinfo is None else parsed.astimezone(CN)


def _normalized_title(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "", value).lower()


def _source_weight(source: str) -> float:
    if "交易所" in source:
        return 32
    if "公告" in source:
        return 28
    if "财经" in source:
        return 16
    return 8


def _keyword_weight(positive_hits: list[str], risk_hits: list[str]) -> float:
    return min(len(positive_hits) * 4 + len(risk_hits) * 5, 20)


def _recency_weight(published_at: datetime, end: datetime) -> float:
    age_hours = max(0.0, (end - published_at).total_seconds() / 3600)
    return max(0.0, 12.0 - age_hours * 0.5)


def _summary(
    symbols: list[str],
    themes: list[str],
    positive_hits: list[str],
    risk_hits: list[str],
    title: str,
) -> str:
    parts: list[str] = []
    if symbols:
        parts.append(f"关联 {'、'.join(symbols)}")
    if themes:
        parts.append(f"主题：{'、'.join(themes)}")
    hits = risk_hits or positive_hits
    if hits:
        parts.append(f"命中：{'、'.join(hits)}")
    return "；".join(parts) if parts else title
