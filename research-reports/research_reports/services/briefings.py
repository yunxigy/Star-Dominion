"""Generate cited AI briefings from validated news candidates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json

from ..collector.rss import RSSItem


@dataclass(frozen=True, slots=True)
class BriefingResult:
    status: str
    title: str
    summary: str
    events: tuple[dict[str, object], ...]
    risks: tuple[str, ...]
    source_ids: tuple[str, ...]
    model: str | None


class BriefingService:
    def __init__(self, *, ai_client) -> None:
        self._ai_client = ai_client

    def generate(self, items: list[RSSItem], *, now: datetime) -> BriefingResult:
        allowed = {item.content_hash for item in items}
        payload = [
            {"source_id": item.content_hash, "title": item.title, "summary": item.summary, "url": item.canonical_url, "published_at": item.published_at.isoformat()}
            for item in items[:30]
        ]
        try:
            completion = self._ai_client.generate(
                system="你是 AI 早报编辑。只基于输入资料生成严格 JSON，不得补写事实。每个 event 必须引用输入中的 source_id。",
                user=json.dumps({"now": now.isoformat(), "items": payload}, ensure_ascii=False),
            )
            data = json.loads(completion.text)
            source_ids = tuple(str(value) for value in data.get("source_ids", []))
            if any(source_id not in allowed for source_id in source_ids):
                raise ValueError("briefing contains unknown source_id")
            events = tuple(data.get("events", []))
            if any(str(event.get("source_id")) not in allowed for event in events):
                raise ValueError("briefing event contains unknown source_id")
            return BriefingResult("success", str(data.get("title", "AI早报")), str(data.get("summary", "")), events, tuple(str(value) for value in data.get("risks", [])), source_ids, completion.model)
        except Exception:
            fallback = tuple({"source_id": item.content_hash, "title": item.title, "summary": item.summary or "", "url": item.canonical_url} for item in items[:10])
            return BriefingResult("ai_unavailable", "AI早报（候选摘要）", "模型暂时不可用，以下为公开来源候选事件。", fallback, ("模型生成失败，内容需要人工复核。",), tuple(item.content_hash for item in items[:10]), None)
