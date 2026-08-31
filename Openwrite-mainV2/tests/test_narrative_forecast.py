from pathlib import Path

import pytest

from tools.init_project import init_project
from tools.narrative_forecast import (
    NarrativeForecastError,
    NarrativeForecastService,
    narrative_forecast_action,
)


def _branch(index: int, *, horizon: int = 3) -> dict:
    return {
        "title": f"路线 {index}",
        "premise": f"分歧点采用互斥前提 {index}",
        "beats": [
            {
                "offset": offset,
                "chapter_id": f"ch_{offset:03d}",
                "summary": f"路线 {index} 的第 {offset} 个未来节拍",
            }
            for offset in range(1, horizon + 1)
        ],
        "character_decisions": [
            {"character": "林舟", "decision": f"作出路线 {index} 的关键决定"}
        ],
        "projected_changes": {
            "characters": [f"林舟进入状态 {index}"],
            "relationships": [f"联盟关系变化 {index}"],
            "world": [f"城市局势变化 {index}"],
            "foreshadowing": [f"推进伏笔 {index}"],
        },
        "risks": [
            {"kind": "causality", "description": f"需要补足因果链 {index}"}
        ],
        "uncertainties": [f"对手是否介入 {index}"],
        "intent_alignment": {
            "score": 70 + index,
            "rationale": f"与作者当前方向的匹配说明 {index}",
        },
    }


def _source_snapshot(project_root: Path, novel_id: str) -> dict[str, bytes]:
    source_root = project_root / "data" / "novels" / novel_id / "src"
    return {
        path.relative_to(source_root).as_posix(): path.read_bytes()
        for path in source_root.rglob("*")
        if path.is_file()
    }


def test_narrative_forecast_stages_and_selects_without_modifying_canon(tmp_path: Path):
    init_project(tmp_path, "demo", "雾城来信")
    service = NarrativeForecastService(tmp_path, "demo")
    source_before = _source_snapshot(tmp_path, "demo")

    candidate = service.create(
        divergence="林舟接受钟楼管理员的合作，还是公开拒绝？",
        anchor_chapter_id="ch_001",
        branch_count=3,
        horizon=3,
    )

    assert candidate.state == "candidate"
    assert candidate.branches == ()
    assert candidate.anchor_chapter_id == "ch_001"
    assert candidate.anchor_chapter_title == "第一章"
    assert candidate.anchor_chapter_number == 1
    assert "正典推演上下文" in candidate.context_brief
    assert "分歧锚点章节" in candidate.context_brief
    assert "[offset=1]" in candidate.context_brief
    assert "offset=1 必须对应锚点章节 ch_001" in service.goethe_brief(candidate)
    assert service.is_stale(candidate) is False

    staged = service.stage(
        candidate.forecast_id,
        [_branch(index) for index in range(1, 4)],
        forecast_revision=service.revision(candidate),
    )

    assert staged.state == "active"
    assert [branch.branch_id for branch in staged.branches] == [
        "branch-1",
        "branch-2",
        "branch-3",
    ]
    assert service.comparison_path(staged.forecast_id).is_file()
    assert "意图匹配" in service.comparison_path(staged.forecast_id).read_text(
        encoding="utf-8"
    )

    selected = service.select(
        staged.forecast_id,
        "branch-2",
        forecast_revision=service.revision(staged),
    )

    assert selected.selected_branch_id == "branch-2"
    selected_plan = service.selected_plan_path(selected.forecast_id)
    assert selected_plan.is_file()
    assert "不会修改正典" in selected_plan.read_text(encoding="utf-8")
    assert _source_snapshot(tmp_path, "demo") == source_before


def test_narrative_forecast_detects_context_changes_and_rejects_stale_stage(
    tmp_path: Path,
):
    init_project(tmp_path, "demo", "雾城来信")
    service = NarrativeForecastService(tmp_path, "demo")
    candidate = service.create(
        divergence="调查真相还是先保护同伴？",
        anchor_chapter_id="ch_001",
        branch_count=2,
        horizon=3,
    )
    focus_path = (
        tmp_path / "data" / "novels" / "demo" / "src" / "story" / "current_focus.md"
    )
    focus_path.write_text(
        focus_path.read_text(encoding="utf-8") + "\n新增作者聚焦：优先保护同伴。\n",
        encoding="utf-8",
    )

    assert service.is_stale(candidate) is True
    with pytest.raises(NarrativeForecastError) as caught:
        service.stage(
            candidate.forecast_id,
            [_branch(1), _branch(2)],
            forecast_revision=service.revision(candidate),
        )
    assert caught.value.code == "STALE_FORECAST_INPUT"
    assert service.get(candidate.forecast_id).state == "stale"


def test_narrative_forecast_action_returns_compact_list_payload(tmp_path: Path):
    init_project(tmp_path, "demo", "雾城来信")
    created = narrative_forecast_action(
        tmp_path,
        "demo",
        {
            "action": "create",
            "divergence": "公开线索还是继续隐瞒？",
            "anchor_chapter_id": "ch_001",
            "branch_count": 2,
            "horizon": 2,
        },
    )
    listed = narrative_forecast_action(tmp_path, "demo", {"action": "list"})

    assert created["goethe_brief"]
    assert created["revision"].startswith("sha256:")
    assert listed["forecasts"][0]["forecast_id"] == created["forecast_id"]
    assert listed["recommended_chapter_id"] == "ch_001"
    assert listed["chapter_options"][0]["id"] == "ch_001"
    assert "context_brief" not in listed["forecasts"][0]
    assert "goethe_brief" not in listed["forecasts"][0]


def test_narrative_forecast_requires_existing_outline_anchor(tmp_path: Path):
    init_project(tmp_path, "demo", "雾城来信")
    service = NarrativeForecastService(tmp_path, "demo")

    with pytest.raises(NarrativeForecastError) as missing:
        service.create(
            divergence="公开还是隐瞒？",
            anchor_chapter_id="",
        )
    assert missing.value.code == "ANCHOR_CHAPTER_REQUIRED"

    with pytest.raises(NarrativeForecastError) as unknown:
        service.create(
            divergence="公开还是隐瞒？",
            anchor_chapter_id="ch_999",
        )
    assert unknown.value.code == "ANCHOR_CHAPTER_NOT_FOUND"


def test_narrative_forecast_is_goethe_only_and_visible_in_studio():
    from tools.agent.react import OPENWRITE_TOOLS
    from tools.agent.toolkits import DANTE_DIRECT_TOOLKIT, GOETHE_DIRECT_TOOLKIT

    assert "manage_narrative_forecast" in GOETHE_DIRECT_TOOLKIT
    assert "manage_narrative_forecast" not in DANTE_DIRECT_TOOLKIT
    assert "manage_narrative_forecast" in {tool.name for tool in OPENWRITE_TOOLS}

    assets = Path(__file__).parents[1] / "tools" / "studio_assets"
    html = (assets / "index.html").read_text(encoding="utf-8")
    javascript = (assets / "js" / "application.js").read_text(encoding="utf-8")
    styles = (assets / "styles.css").read_text(encoding="utf-8")

    assert 'id="narrative-forecast-divergence"' in html
    assert 'id="narrative-forecast-anchor"' in html
    assert 'id="narrative-forecast-comparison"' in html
    assert 'id="narrative-forecast-select-branch"' in html
    assert 'api("/api/narrative-forecasts"' in javascript
    assert "anchor_chapter_id: anchorChapterId" in javascript
    assert "renderNarrativeForecastComparison" in javascript
    assert ".narrative-forecast-detail" in styles
