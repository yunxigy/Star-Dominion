from datetime import UTC, datetime
from pathlib import Path

from app.domain.candidates import CandidateSource, CandidateStock
from app.integrations.candidate_sources import CandidateBatch, CandidateSourceError
from app.repositories.candidate_snapshots import CandidateSnapshotRepository
from app.services.candidate_refresh import CandidateRefreshService


class FakeSource:
    def __init__(self, source_id: str, source_name: str, batch: CandidateBatch | None = None) -> None:
        self.source_id = source_id
        self.source_name = source_name
        self.batch = batch
        self.error: str | None = None

    def load(self) -> CandidateBatch:
        if self.error:
            raise CandidateSourceError(self.error)
        assert self.batch is not None
        return self.batch


def test_refresh_persists_each_source_and_survives_repository_restart(tmp_path: Path) -> None:
    catalyst = FakeSource("catalyst", "九点猫研", _batch("catalyst", "九点猫研", "600001", "猫研股"))
    strategy = FakeSource("user_strategy", "用户策略", _batch("user_strategy", "用户策略", "000001", "策略股"))
    database = tmp_path / "hub.db"
    service = CandidateRefreshService(CandidateSnapshotRepository(database), [catalyst, strategy])

    refreshed = service.refresh()
    restarted = CandidateRefreshService(CandidateSnapshotRepository(database), [catalyst, strategy]).get_candidates()

    assert [item.stock.symbol for item in refreshed.items] == ["000001", "600001"]
    assert [item.stock.symbol for item in restarted.items] == ["000001", "600001"]
    assert {status.source_id: status.status for status in refreshed.sources} == {
        "catalyst": "ok",
        "user_strategy": "ok",
    }


def test_failed_source_keeps_old_snapshot_as_stale_while_other_source_updates(tmp_path: Path) -> None:
    catalyst = FakeSource("catalyst", "九点猫研", _batch("catalyst", "九点猫研", "600001", "猫研股"))
    strategy = FakeSource("user_strategy", "用户策略", _batch("user_strategy", "用户策略", "000001", "旧策略股"))
    service = CandidateRefreshService(CandidateSnapshotRepository(tmp_path / "hub.db"), [catalyst, strategy])
    service.refresh()

    catalyst.error = "上游暂时不可用"
    strategy.batch = _batch("user_strategy", "用户策略", "002001", "新策略股")
    result = service.refresh()

    assert [item.stock.symbol for item in result.items] == ["002001", "600001"]
    statuses = {status.source_id: status for status in result.sources}
    assert statuses["catalyst"].status == "stale"
    assert statuses["catalyst"].error == "上游暂时不可用"
    assert statuses["user_strategy"].status == "ok"


def test_all_failed_without_history_returns_empty_items_and_error_statuses(tmp_path: Path) -> None:
    catalyst = FakeSource("catalyst", "九点猫研")
    strategy = FakeSource("user_strategy", "用户策略")
    catalyst.error = "猫研失败"
    strategy.error = "策略失败"
    service = CandidateRefreshService(CandidateSnapshotRepository(tmp_path / "hub.db"), [catalyst, strategy])

    result = service.refresh()

    assert result.items == []
    assert [status.status for status in result.sources] == ["error", "error"]


def _batch(source_id: str, source_name: str, symbol: str, name: str) -> CandidateBatch:
    generated_at = datetime(2026, 7, 21, 7, 30, tzinfo=UTC)
    item = CandidateStock.create(
        symbol=symbol,
        name=name,
        source=CandidateSource(source_id=source_id, source_name=source_name, score=80, reasons=["测试原因"]),
    )
    item.generated_at = generated_at
    return CandidateBatch(source_id=source_id, generated_at=generated_at, items=[item])
