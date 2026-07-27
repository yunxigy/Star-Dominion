from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from app.domain.mom_index import (
    MomIndexSnapshot,
    MomSectorIndex,
    MomSourceStatus,
)
from app.repositories.mom_index import MomIndexRepository


def snapshot(day: int, index: float) -> MomIndexSnapshot:
    sector = MomSectorIndex(
        sector_id="nasdaq",
        name="纳斯达克",
        index=index,
        buy_index=20,
        sell_index=10,
        total_posts=20,
        valid_posts=18,
        newbie_posts=6,
        newbie_ratio=33.3,
        buy_count=3,
        sell_count=1,
        risk_level="normal",
        interpretation="正常区间",
        top_posts=[],
    )
    return MomIndexSnapshot(
        snapshot_date=date(2026, 7, day),
        generated_at=datetime(2026, 7, day, 0, 30, tzinfo=UTC),
        completeness="complete",
        sectors={"nasdaq": sector},
        sources=[
            MomSourceStatus(
                source_id="eastmoney",
                status="ok",
                collected_at=datetime(2026, 7, day, 0, 20, tzinfo=UTC),
                post_count=20,
            )
        ],
    )


def test_repository_returns_latest_snapshot_and_descending_history(tmp_path) -> None:
    repository = MomIndexRepository(tmp_path / "hub.db")
    repository.save(snapshot(26, 35))
    repository.save(snapshot(27, 62))

    assert repository.current().snapshot_date == date(2026, 7, 27)
    assert [item.snapshot_date for item in repository.history(2)] == [
        date(2026, 7, 27),
        date(2026, 7, 26),
    ]


def test_source_status_rejects_simulated_source() -> None:
    with pytest.raises(ValidationError):
        MomSourceStatus(
            source_id="simulated",
            status="ok",
            collected_at=datetime.now(UTC),
            post_count=12,
        )
