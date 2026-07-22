import json
from pathlib import Path

import pytest

from app.integrations.candidate_sources import (
    CandidateSourceError,
    CatalystReportSource,
    UserStrategySnapshotSource,
)


def test_catalyst_report_maps_native_report_and_excludes_other_boards(tmp_path: Path) -> None:
    path = tmp_path / "catalyst.json"
    path.write_text(
        json.dumps(
            {
                "ok": True,
                "result": {
                    "generated_at": "2026-07-21T08:30:00+08:00",
                    "themes": [
                        {
                            "theme": {"id": "ai", "name": "AI 算力"},
                            "top": [
                                {
                                    "candidate": {"code": "600001", "name": "主板示例", "rationale": "海外映射"},
                                    "score": 78.5,
                                },
                                {
                                    "candidate": {"code": "300001", "name": "创业示例", "rationale": "应被排除"},
                                    "score": 99,
                                },
                            ],
                        }
                    ],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    batch = CatalystReportSource(path).load()

    assert batch.source_id == "catalyst"
    assert batch.generated_at.isoformat() == "2026-07-21T08:30:00+08:00"
    assert [item.stock.symbol for item in batch.items] == ["600001"]
    assert batch.items[0].generated_at == batch.generated_at
    assert batch.items[0].sources[0].score == 78.5
    assert batch.items[0].sources[0].reasons == ["主题：AI 算力", "海外映射"]


def test_user_strategy_snapshot_only_emits_matched_main_board_stocks(tmp_path: Path) -> None:
    path = tmp_path / "strategy.json"
    ordinary = [_bar(10 + index * 0.1, 1.0) for index in range(12)]
    dragon = ordinary[:-3] + [_bar(12, 9.8), _bar(13.1, 9.7), _bar(14.4, 9.9)]
    path.write_text(
        json.dumps(
            {
                "generated_at": "2026-07-21T15:35:00+08:00",
                "stocks": [
                    {"symbol": "600001", "name": "龙头示例", "concepts": ["机器人"], "bars": dragon},
                    {"symbol": "000001", "name": "普通示例", "concepts": [], "bars": ordinary},
                    {"symbol": "300001", "name": "创业示例", "concepts": [], "bars": dragon},
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    batch = UserStrategySnapshotSource(path).load()

    assert [item.stock.symbol for item in batch.items] == ["600001"]
    source = batch.items[0].sources[0]
    assert source.source_id == "user_strategy"
    assert source.score == 100
    assert source.reasons == ["龙头识别：情绪龙头：近 5 日出现至少 3 连板", "题材：机器人"]


def test_broken_snapshot_raises_source_error(tmp_path: Path) -> None:
    path = tmp_path / "broken.json"
    path.write_text("{broken", encoding="utf-8")

    with pytest.raises(CandidateSourceError, match="无法解析"):
        CatalystReportSource(path).load()


def test_missing_snapshot_raises_source_error(tmp_path: Path) -> None:
    with pytest.raises(CandidateSourceError, match="不存在"):
        UserStrategySnapshotSource(tmp_path / "missing.json").load()


def test_catalyst_directory_uses_latest_dated_report(tmp_path: Path) -> None:
    reports = tmp_path / "reports"
    reports.mkdir()
    for date, symbol in (("2026-07-20", "600001"), ("2026-07-21", "600002")):
        (reports / f"{date}-morning.json").write_text(
            json.dumps(
                {
                    "generated_at": f"{date}T08:30:00+08:00",
                    "themes": [
                        {
                            "theme": {"name": "测试主题"},
                            "top": [{"candidate": {"code": symbol, "name": symbol}, "score": 80}],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

    batch = CatalystReportSource(reports).load()

    assert [item.stock.symbol for item in batch.items] == ["600002"]


def _bar(close: float, pct: float) -> dict[str, float]:
    return {
        "open": close * 0.99,
        "high": close * 1.02,
        "low": close * 0.99,
        "close": close,
        "pct": pct,
        "volume": 100,
    }
