"""Aggregate real social sources into persisted Mom Index snapshots."""

from collections.abc import Callable
from datetime import UTC, datetime
from statistics import mean

from app.domain.mom_index import (
    MomIndexSnapshot,
    MomPostEvidence,
    MomSectorIndex,
)
from app.integrations.mom_sources import MomCollectedPost, SECTORS
from app.repositories.mom_index import MomIndexRepository


class MomIndexUnavailable(RuntimeError):
    """Raised when no real source produced data for a refresh."""


BUY_WORDS = ("买", "上车", "加仓", "抄底", "定投", "冲", "满仓", "梭哈")
SELL_WORDS = ("卖", "割肉", "止损", "清仓", "亏", "跑")
NEWBIE_SIGNALS = (
    (("小白", "新手", "宝妈"), 8),
    (("怎么买", "不懂", "请教", "求教"), 6),
    (("要不要", "还能买吗", "该不该", "可以进吗"), 7),
    (("亏麻", "好慌", "崩了", "救命"), 5),
    (("听博主", "朋友推荐", "听说"), 6),
    (("梭哈", "满仓", "稳赚"), 4),
)


def _classification(title: str) -> tuple[float, str, str]:
    score = min(100.0, float(sum(weight for words, weight in NEWBIE_SIGNALS if any(word in title for word in words))))
    buy = any(word in title for word in BUY_WORDS)
    sell = any(word in title for word in SELL_WORDS)
    intent = "buy" if buy and not sell else "sell" if sell and not buy else "neutral"
    matched = [words[0] for words, _ in NEWBIE_SIGNALS if any(word in title for word in words)]
    reasoning = "、".join(matched) if matched else "未命中新手信号"
    return score, intent, reasoning


def _risk(index: float) -> tuple[str, str]:
    if index < 20:
        return "cold", "极度冷清"
    if index < 40:
        return "normal", "正常区间"
    if index < 60:
        return "warming", "开始升温"
    if index < 75:
        return "warning", "高度警惕"
    return "extreme", "极度狂热"


def _sector_index(sector_id: str, posts: list[MomCollectedPost]) -> MomSectorIndex:
    classified = [(post, *_classification(post.title)) for post in posts]
    newbies = [item for item in classified if item[1] >= 6]
    buy = [item for item in newbies if item[2] == "buy"]
    sell = [item for item in newbies if item[2] == "sell"]
    total = len(posts)
    newbie_ratio = round(len(newbies) / total * 100, 1) if total else 0.0
    average_score = mean(item[1] for item in newbies) if newbies else 0.0
    extreme_ratio = round((len(buy) + len(sell)) / len(newbies) * 100, 1) if newbies else 0.0
    purity = round(sum(1 for item in newbies if item[1] >= 20) / len(newbies) * 100, 1) if newbies else 0.0
    index = round(newbie_ratio * 0.40 + average_score * 0.25 + extreme_ratio * 0.20 + purity * 0.15, 1)
    activity = min(100.0, total * 2.0)
    buy_index = round(min(100.0, (len(buy) / max(1, len(newbies))) * 50 + activity * 0.30 + (mean(item[1] for item in buy) if buy else 0) * 0.20), 1)
    sell_index = round(min(100.0, (len(sell) / max(1, len(newbies))) * 50 + activity * 0.30 + (mean(item[1] for item in sell) if sell else 0) * 0.20), 1)
    risk_level, interpretation = _risk(index)
    evidence = [
        MomPostEvidence(
            platform=post.platform,
            platform_id=post.platform_id,
            title=post.title,
            url=post.url,
            published_at=post.published_at,
            collected_at=post.collected_at,
            reasoning=reasoning,
            intent=intent,
        )
        for post, _, intent, reasoning in sorted(newbies, key=lambda item: item[1], reverse=True)[:3]
    ]
    return MomSectorIndex(
        sector_id=sector_id,
        name=SECTORS[sector_id]["name"],
        index=index,
        buy_index=buy_index,
        sell_index=sell_index,
        total_posts=total,
        valid_posts=total,
        newbie_posts=len(newbies),
        newbie_ratio=newbie_ratio,
        buy_count=len(buy),
        sell_count=len(sell),
        risk_level=risk_level,
        interpretation=interpretation,
        top_posts=evidence,
    )


class MomIndexService:
    def __init__(
        self,
        repository: MomIndexRepository,
        *,
        eastmoney,
        xiaohongshu,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._eastmoney = eastmoney
        self._xiaohongshu = xiaohongshu
        self._clock = clock or (lambda: datetime.now(UTC))

    def refresh(self) -> MomIndexSnapshot:
        results = [self._eastmoney.collect(), self._xiaohongshu.collect()]
        successful = [result for result in results if result.status.status == "ok"]
        if not successful:
            raise MomIndexUnavailable("东方财富和小红书均未采集到真实数据")
        posts = [post for result in successful for post in result.posts]
        now = self._clock()
        snapshot = MomIndexSnapshot(
            snapshot_date=now.date(),
            generated_at=now,
            completeness="complete" if len(successful) == 2 else "partial",
            sectors={
                sector_id: _sector_index(
                    sector_id,
                    [post for post in posts if post.sector_id == sector_id],
                )
                for sector_id in SECTORS
            },
            sources=[result.status for result in results],
        )
        self._repository.save(snapshot)
        return snapshot

    def current(self) -> MomIndexSnapshot | None:
        return self._repository.current()

    def history(self, limit: int = 30) -> list[MomIndexSnapshot]:
        return self._repository.history(limit)
