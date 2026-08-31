import json
from pathlib import Path

import pytest
import yaml

from tools.init_project import init_project
from tools.novel_service import NovelApplicationService, NovelServiceError
from tools.source_pack import SourcePackService


def test_source_pack_refresh_review_and_promotion_are_cli_independent(tmp_path: Path):
    init_project(tmp_path, "demo", "雾城来信")
    service = SourcePackService(tmp_path, "demo")
    source_root = service.source_root("clock_reference")
    batch_root = source_root / "extraction" / "batch_results"
    batch_root.mkdir(parents=True)
    (batch_root / "batch_000.yaml").write_text(
        yaml.safe_dump(
            {
                "findings": {
                    "craft": ["用物件偏差制造悬念", "对话保留潜台词"],
                    "author": ["克制的第三人称叙述", "短句推动节奏"],
                    "novel": [
                        "规则：钟楼每天会少走十三秒",
                        "组织：守钟人协会负责维护钟楼",
                        "时间：三年前钟楼曾经停摆",
                    ],
                    "summary": "以钟表误差推动悬疑。",
                }
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    progress_root = source_root / "extraction"
    (progress_root / "progress.json").write_text(
        json.dumps(
            {
                "current_phase": "completed",
                "completed_count": 1,
                "pending_count": 0,
                "progress_pct": 100,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    service.refresh_documents("clock_reference")
    review = service.render_review("clock_reference")
    promoted = service.promote("clock_reference", "all")

    assert promoted == ["style", "setting", "world"]
    assert "来源审阅：clock_reference" in review
    assert "进度: 100%" in review
    assert "以钟表误差推动悬疑" in (source_root / "source.md").read_text(
        encoding="utf-8"
    )
    config = yaml.safe_load((tmp_path / "novel_config.yaml").read_text(encoding="utf-8"))
    assert config["style_id"] == "clock_reference"
    novel_root = tmp_path / "data" / "novels" / "demo"
    assert "来源提取：clock_reference" in (
        novel_root / "src" / "story" / "foundation.md"
    ).read_text(encoding="utf-8")
    assert "钟楼每天会少走十三秒" in (
        novel_root / "src" / "world" / "rules.md"
    ).read_text(encoding="utf-8")
    assert list((novel_root / "src" / "world" / "entities").glob("*.md"))


def test_source_pack_review_surfaces_v2_evidence_without_claiming_legacy_promotion(
    tmp_path: Path,
):
    init_project(tmp_path, "demo", "证据来源")
    service = SourcePackService(tmp_path, "demo")
    analysis_root = service.source_root("opening") / "analysis_v2"
    analysis_root.mkdir(parents=True)
    (analysis_root / "report.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "source_id": "opening",
                "relative_name": "opening.txt",
                "status": "completed",
                "summary": "用连续异响推动开场。",
                "findings": [
                    {
                        "category": "pacing",
                        "claim": "让异常信号逐次升级",
                        "evidence": [
                            {"start": 0, "end": 2, "quote": "钟声"},
                            {"start": 4, "end": 6, "quote": "脚步"},
                        ],
                    }
                ],
                "failed_chunks": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    review = service.render_review("opening")
    metadata = service.review_metadata("opening")

    assert "规范名称: opening.txt" in review
    assert "结论数: 1" in review
    assert "证据数: 2" in review
    assert "全量晋升: 不可用" in review
    assert metadata == {
        "analysis_version": 2,
        "canonical_name": "opening.txt",
        "analysis_status": "completed",
        "finding_count": 1,
        "evidence_count": 2,
        "promotion_ready": False,
        "available_targets": [],
        "missing_items": ["style/*.md", "setting_profile.md"],
    }


def test_source_pack_all_promotion_preflights_before_any_partial_write(tmp_path: Path):
    init_project(tmp_path, "demo", "原子晋升")
    source = SourcePackService(tmp_path, "demo")
    root = source.source_root("style_only")
    (root / "style").mkdir(parents=True)
    (root / "style" / "summary.md").write_text(
        "# 风格总结\n\n## reusable_signals\n\n- 短句推进。\n",
        encoding="utf-8",
    )
    config_path = tmp_path / "novel_config.yaml"
    config_before = config_path.read_text(encoding="utf-8")

    with pytest.raises(NovelServiceError) as incomplete:
        NovelApplicationService(tmp_path).promote_source("style_only", "all")

    assert incomplete.value.code == "SOURCE_INCOMPLETE"
    assert "setting_profile.md" in str(incomplete.value)
    assert config_path.read_text(encoding="utf-8") == config_before
