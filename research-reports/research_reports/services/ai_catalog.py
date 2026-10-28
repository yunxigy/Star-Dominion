"""Rule-based classification for AI-focused GitHub repositories."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select

from ..database import Database
from ..models import AICatalogEntry, AICatalogRun, RankingEntry, Repository, WeeklyIssue


@dataclass(frozen=True, slots=True)
class AICategoryMatch:
    primary_category: str
    categories: tuple[str, ...]
    score: int
    reasons: tuple[str, ...]


_CATEGORY_TERMS: dict[str, tuple[str, ...]] = {
    "agent_skill": ("agent", "skill", "tool-use", "function-calling", "workflow"),
    "mcp": ("mcp", "model-context-protocol"),
    "llm_rag": ("llm", "rag", "embedding", "vector", "transformer", "inference"),
    "computer_use": ("computer-use", "browser-agent", "browser-automation", "desktop-agent"),
    "ai_app": ("chatbot", "coding-agent", "copilot", "ai-app", "assistant"),
    "ai_infra": ("llm-serving", "model-serving", "vllm", "training", "gpu", "fine-tune"),
}
_NEGATIVE_TERMS = ("tutorial", "course", "notes", "dataset", "benchmark-only")


def classify_repository(
    *,
    name: str,
    description: str | None,
    topics: list[str] | tuple[str, ...],
) -> AICategoryMatch:
    normalized_name = name.lower()
    normalized_description = (description or "").lower()
    normalized_topics = tuple(topic.lower() for topic in topics)
    matches: list[tuple[str, int, list[str]]] = []

    for category, terms in _CATEGORY_TERMS.items():
        score = 0
        reasons: list[str] = []
        for term in terms:
            if any(term == topic or term in topic for topic in normalized_topics):
                score += 5
                reasons.append(f"topic:{term}")
            if term in normalized_name:
                score += 3
                reasons.append(f"name:{term}")
            if term in normalized_description:
                score += 1
                reasons.append(f"description:{term}")
        if score:
            matches.append((category, score, reasons))

    negative_hits = [term for term in _NEGATIVE_TERMS if term in normalized_name or term in normalized_description]
    if negative_hits:
        penalty = 2 * len(negative_hits)
        matches = [(category, max(0, score - penalty), reasons + [f"negative:{term}" for term in negative_hits]) for category, score, reasons in matches]
    matches.sort(key=lambda item: (-item[1], item[0]))
    if "mcp" in normalized_topics or "model-context-protocol" in normalized_topics:
        matches.sort(key=lambda item: (item[0] != "mcp", -item[1], item[0]))
    if not matches:
        return AICategoryMatch(primary_category="other", categories=(), score=0, reasons=())
    return AICategoryMatch(
        primary_category=matches[0][0],
        categories=tuple(category for category, score, _ in matches if score > 0),
        score=matches[0][1],
        reasons=tuple(matches[0][2]),
    )


def persist_ai_catalog(database: Database, *, trigger: str = "scheduled_hourly") -> str:
    """Classify all current ranking entries and persist AICatalogEntry + AICatalogRun.

    Returns the AICatalogRun id.
    """
    run_id: str | None = None
    now = datetime.now(timezone.utc)

    with database.sessions() as session:
        issue = session.scalar(
            select(WeeklyIssue)
            .where(WeeklyIssue.status.in_(("collecting", "delayed")))
            .order_by(WeeklyIssue.starts_at.desc())
        )
        if issue is None:
            calendar = now.isocalendar()
            issue = session.scalar(
                select(WeeklyIssue).where(
                    WeeklyIssue.iso_year == calendar.year,
                    WeeklyIssue.iso_week == calendar.week,
                )
            )
        if issue is None:
            run = AICatalogRun(trigger=trigger, status="skipped", finished_at=now, counts_json={}, error_summary="no active issue")
            session.add(run)
            session.commit()
            return run.id

        issue_id = issue.id
        catalog_run = AICatalogRun(trigger=trigger, started_at=now, status="running")
        session.add(catalog_run)
        session.commit()
        run_id = catalog_run.id

    rows: list[tuple[RankingEntry, Repository]] = []
    with database.sessions() as session:
        rows = list(
            session.execute(
                select(RankingEntry, Repository)
                .join(Repository, Repository.id == RankingEntry.repository_id)
                .where(RankingEntry.issue_id == issue_id)
            ).all()
        )

    counts: dict[str, int] = {}
    seen: set[str] = set()

    with database.sessions() as session:
        for entry, repository in rows:
            match = classify_repository(
                name=repository.full_name,
                description=repository.description,
                topics=list(repository.topics_json or []),
            )
            if match.primary_category == "other" or repository.full_name.lower() in seen:
                continue
            seen.add(repository.full_name.lower())

            existing = session.scalar(
                select(AICatalogEntry).where(
                    AICatalogEntry.issue_id == issue_id,
                    AICatalogEntry.repository_id == repository.id,
                    AICatalogEntry.category == match.primary_category,
                )
            )
            if existing is not None:
                existing.score = match.score
                existing.reasons_json = list(match.reasons)
                existing.status = "active"
            else:
                session.add(
                    AICatalogEntry(
                        issue_id=issue_id,
                        repository_id=repository.id,
                        category=match.primary_category,
                        score=match.score,
                        reasons_json=list(match.reasons),
                        status="active",
                    )
                )
            counts[match.primary_category] = counts.get(match.primary_category, 0) + 1

        # Deactivate entries for repos no longer in current rankings
        active_repo_ids = {repository.id for entry, repository in rows}
        stale = list(
            session.scalars(
                select(AICatalogEntry).where(
                    AICatalogEntry.issue_id == issue_id,
                    AICatalogEntry.status == "active",
                    AICatalogEntry.repository_id.notin_(active_repo_ids),
                )
            )
        )
        for entry in stale:
            entry.status = "removed"
            counts.setdefault("removed", 0)
            counts["removed"] += 1

        session.commit()

    with database.sessions() as session:
        catalog_run = session.get(AICatalogRun, run_id)
        if catalog_run is not None:
            catalog_run.status = "success"
            catalog_run.finished_at = datetime.now(timezone.utc)
            catalog_run.counts_json = counts
            session.commit()

    return run_id
