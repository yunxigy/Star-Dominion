"""Unified candidate models shared by every discovery source."""

from datetime import UTC, datetime

from pydantic import BaseModel, Field

from app.domain.stocks import exchange_for, normalize_symbol


class StockIdentity(BaseModel):
    symbol: str
    name: str
    exchange: str
    board: str = "MAIN"
    market: str = "CN_A"


class CandidateSource(BaseModel):
    source_id: str
    source_name: str
    score: float | None = None
    reasons: list[str] = Field(default_factory=list)


class CandidateStock(BaseModel):
    stock: StockIdentity
    sources: list[CandidateSource]
    generated_at: datetime

    @classmethod
    def create(
        cls,
        symbol: str,
        name: str,
        source: CandidateSource,
    ) -> "CandidateStock":
        normalized = normalize_symbol(symbol)
        return cls(
            stock=StockIdentity(
                symbol=normalized,
                name=name,
                exchange=exchange_for(normalized),
            ),
            sources=[source],
            generated_at=datetime.now(UTC),
        )


def merge_candidates(items: list[CandidateStock]) -> list[CandidateStock]:
    """Merge candidates by symbol while preserving distinct source evidence."""
    merged: dict[str, CandidateStock] = {}
    for item in items:
        symbol = item.stock.symbol
        if symbol not in merged:
            merged[symbol] = item.model_copy(deep=True)
            continue

        existing_ids = {source.source_id for source in merged[symbol].sources}
        merged[symbol].sources.extend(
            source.model_copy(deep=True)
            for source in item.sources
            if source.source_id not in existing_ids
        )

    return sorted(merged.values(), key=lambda candidate: candidate.stock.symbol)
