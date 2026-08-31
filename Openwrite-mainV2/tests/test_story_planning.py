from pathlib import Path

from tools.frontmatter import parse_toml_front_matter
from tools.story_planning import StoryPlanningStore


def test_append_ideation_writes_runtime_draft(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")

    store.append_ideation("主角是社畜术师")
    store.append_ideation("设定偏现代都市修仙")

    assert "主角是社畜术师" in store.ideation_path.read_text(encoding="utf-8")
    assert "设定偏现代都市修仙" in store.ideation_path.read_text(encoding="utf-8")


def test_ideation_summary_tracks_current_ideation_hash(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")

    store.append_ideation("主角是社畜术师")
    store.save_ideation_summary(
        """# 当前想法汇总

## 核心方向

- 都市职场异能
"""
    )

    assert store.ideation_summary_path.exists()
    assert store.ideation_summary_is_current() is True

    store.append_ideation("公司地下还有隐秘节点")

    assert store.ideation_summary_is_current() is False


def test_confirmed_ideation_summary_seeds_placeholder_foundation(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.story_src_dir.mkdir(parents=True, exist_ok=True)
    foundation_path = store.story_src_dir / "foundation.md"
    foundation_path.write_text(
        "# 基础设定\n\n## 核心机制\n\n（待填写）\n",
        encoding="utf-8",
    )
    store.append_ideation("主角是被雪藏的穿越艺人")
    store.save_ideation_summary(
        "# 当前想法汇总\n\n## 核心方向\n\n- 娱乐圈成长爽文\n"
    )

    seeded = store.seed_placeholder_foundation_from_ideation_summary()

    assert seeded is True
    assert "娱乐圈成长爽文" in foundation_path.read_text(encoding="utf-8")
    assert foundation_path.read_text(encoding="utf-8") == (
        store.foundation_draft_path.read_text(encoding="utf-8")
    )


def test_confirmed_ideation_summary_does_not_replace_existing_foundation(
    tmp_path: Path,
):
    store = StoryPlanningStore(tmp_path, "demo")
    store.story_src_dir.mkdir(parents=True, exist_ok=True)
    foundation_path = store.story_src_dir / "foundation.md"
    foundation_path.write_text(
        "# 基础设定\n\n## 核心机制\n\n歌曲会触发记忆共鸣。\n",
        encoding="utf-8",
    )
    store.append_ideation("主角是被雪藏的穿越艺人")
    store.save_ideation_summary("# 当前想法汇总\n\n- 娱乐圈成长爽文\n")

    seeded = store.seed_placeholder_foundation_from_ideation_summary()

    assert seeded is False
    assert "歌曲会触发记忆共鸣" in foundation_path.read_text(encoding="utf-8")
    assert not store.foundation_draft_path.exists()


def test_promote_foundation_writes_src_story_files(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")

    store.save_foundation_draft(background="背景A", foundation="设定B")
    promoted = store.promote_foundation()

    assert promoted is True
    background_meta, background_body = parse_toml_front_matter(
        (store.story_src_dir / "background.md").read_text(encoding="utf-8")
    )
    foundation_meta, foundation_body = parse_toml_front_matter(
        (store.story_src_dir / "foundation.md").read_text(encoding="utf-8")
    )

    assert background_meta["id"] == "story_background"
    assert background_meta["type"] == "story_document"
    assert background_meta["summary"] == "背景A"
    assert background_body.strip() == "背景A"

    assert foundation_meta["id"] == "story_foundation"
    assert foundation_meta["type"] == "story_document"
    assert foundation_meta["summary"] == "设定B"
    assert foundation_body.strip() == "设定B"


def test_save_foundation_draft_normalizes_runtime_drafts(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")

    store.save_foundation_draft(background="背景A", foundation="设定B")

    background_meta, background_body = parse_toml_front_matter(
        store.background_draft_path.read_text(encoding="utf-8")
    )
    foundation_meta, foundation_body = parse_toml_front_matter(
        store.foundation_draft_path.read_text(encoding="utf-8")
    )

    assert background_meta["id"] == "story_background"
    assert foundation_meta["id"] == "story_foundation"
    assert background_body.strip() == "背景A"
    assert foundation_body.strip() == "设定B"
    assert not (store.story_src_dir / "background.md").exists()
    assert not (store.story_src_dir / "foundation.md").exists()


def test_load_story_document_returns_metadata_and_body(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.story_src_dir.mkdir(parents=True, exist_ok=True)
    (store.story_src_dir / "background.md").write_text(
        """+++
id = "story_background"
type = "story_document"
summary = "都市异能职场故事。"
detail_refs = ["premise", "conflict"]
+++

# 背景

都市异能职场故事。
""",
        encoding="utf-8",
    )

    document = store.load_story_document("background")

    assert document["meta"]["id"] == "story_background"
    assert document["meta"]["summary"] == "都市异能职场故事。"
    assert document["body"].lstrip().startswith("# 背景")


def test_outline_requires_confirmation_before_promotion(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")

    store.save_outline_draft("# 大纲草案")

    assert store.promote_outline(confirmed=False) is False
    assert store.outline_src_path.exists() is False
    assert store.outline_draft_path.read_text(encoding="utf-8") == "# 大纲草案"


def test_outline_promotion_requires_confirmed_draft(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")

    store.save_outline_draft("# 大纲草案")

    assert store.promote_outline(confirmed=True) is True
    assert store.outline_src_path.read_text(encoding="utf-8") == "# 大纲草案"
    assert store.outline_draft_path.read_text(encoding="utf-8") == "# 大纲草案"


def test_save_outline_draft_only_stages_until_confirmation(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    content = """# 大纲草案

#### 第一章：起步

> 内容焦点: 主角第一次接触异常。

<!-- OPENWRITE:LONG_RANGE_PLAN:START -->
# 长线规划

## 第一篇：未来规划
### 第一节：更远的冲突
- 概要：这里只是长线规划，不该进入当前可写窗口解析。
<!-- OPENWRITE:LONG_RANGE_PLAN:END -->
"""

    store.save_outline_draft(content)

    assert store.outline_src_path.exists() is False
    assert store.outline_draft_path.read_text(encoding="utf-8") == content
    assert store.outline_edit_state_path.exists()


def test_stage_outline_edits_preserves_unmentioned_content_until_confirmation(
    tmp_path: Path,
):
    store = StoryPlanningStore(tmp_path, "demo")
    original = """# 测试小说

#### 第一章：开端

> 内容焦点: 主角进入雾城。

#### 第二章：追踪

> 内容焦点: 主角追查钟楼。
"""
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(original, encoding="utf-8")

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[
            {
                "old_text": "#### 第二章：追踪\n\n> 内容焦点: 主角追查钟楼。",
                "new_text": "#### 第二章：潜入\n\n> 内容焦点: 主角夜探钟楼。",
            }
        ],
    )

    assert result["ok"] is True
    assert result["next_action"] == "confirm_outline_edits"
    assert "-#### 第二章：追踪" in result["diff"]
    assert "+#### 第二章：潜入" in result["diff"]
    assert store.outline_src_path.read_text(encoding="utf-8") == original
    assert "#### 第一章：开端" in store.outline_draft_path.read_text(encoding="utf-8")

    assert store.promote_outline(confirmed=True) is True
    promoted = store.outline_src_path.read_text(encoding="utf-8")
    assert "#### 第一章：开端" in promoted
    assert "#### 第二章：潜入" in promoted
    assert "#### 第二章：追踪" not in promoted
    assert store.outline_edit_state_path.exists() is False


def test_stage_outline_edits_replaces_markdown_section_without_copying_old_text(
    tmp_path: Path,
):
    store = StoryPlanningStore(tmp_path, "demo")
    original = """# 测试小说

### 第一节：开端

旧节概要。

#### 第一章：旧章

旧章内容。

### 第二节：追踪

必须保留的相邻内容。
"""
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(original, encoding="utf-8")

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[
            {
                "section_heading": "第一节：开端",
                "new_text": (
                    "新节概要。\n\n#### 第一章：潮涌\n\n"
                    "> 内容焦点: 主角遭遇潮涌。\n> 预估字数: 6000"
                ),
            }
        ],
        final_batch=False,
    )

    assert result["ok"] is True
    assert result["applied"][0]["mode"] == "section"
    assert result["applied"][0]["section_heading"] == "### 第一节：开端"
    assert store.outline_src_path.read_text(encoding="utf-8") == original
    draft = store.outline_draft_path.read_text(encoding="utf-8")
    assert "### 第一节：开端\n\n新节概要。" in draft
    assert "#### 第一章：潮涌" in draft
    assert "旧节概要" not in draft
    assert "旧章内容" not in draft
    assert "### 第二节：追踪\n\n必须保留的相邻内容。" in draft


def test_stage_outline_edits_replaces_range_between_short_anchors(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    original = (
        "# 大纲\n\n范围开头的唯一短句\n旧内容一\n旧内容二\n"
        "范围结尾的唯一短句\n\n相邻内容保留\n"
    )
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(original, encoding="utf-8")

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[
            {
                "start_text": "范围开头的唯一短句",
                "end_text": "范围结尾的唯一短句",
                "new_text": "精简后的新内容",
            }
        ],
        final_batch=False,
    )

    assert result["ok"] is True
    assert result["applied"][0]["mode"] == "range"
    assert result["applied"][0]["automatic"] is False
    draft = store.outline_draft_path.read_text(encoding="utf-8")
    assert "精简后的新内容" in draft
    assert "旧内容一" not in draft
    assert "范围开头的唯一短句" not in draft
    assert "相邻内容保留" in draft


def test_stage_outline_edits_normalizes_quote_style_and_whitespace_for_unique_old_text(
    tmp_path: Path,
):
    store = StoryPlanningStore(tmp_path, "demo")
    original = '# 大纲\n\n守门人说：“门后的名字不能写错。”\n\n相邻内容保留。\n'
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(original, encoding="utf-8")

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[
            {
                "old_text": '守门人说：  "门后的名字不能写错。"',
                "new_text": "守门人要求逐字核对门后的名字。",
            }
        ],
        final_batch=False,
    )

    assert result["ok"] is True
    assert result["applied"][0]["mode"] == "normalized_text"
    assert result["applied"][0]["automatic"] is True
    draft = store.outline_draft_path.read_text(encoding="utf-8")
    assert "守门人要求逐字核对门后的名字。" in draft
    assert "相邻内容保留。" in draft


def test_long_old_text_mismatch_automatically_falls_back_to_range_anchors(
    tmp_path: Path,
):
    store = StoryPlanningStore(tmp_path, "demo")
    start_anchor = "START-UNIQUE"
    end_anchor = "END-UNIQUE12"
    original = (
        f"# 大纲\n\n{start_anchor}{'真' * 100}\n"
        + "当前真实内容。" * 80
        + f"\n{'实' * 100}{end_anchor}\n\n不应被修改\n"
    )
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(original, encoding="utf-8")
    inaccurate_old_text = (
        f"{start_anchor}{'错' * 100}\n"
        + "模型记错的中间内容。" * 60
        + f"\n{'误' * 100}{end_anchor}"
    )

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": inaccurate_old_text, "new_text": "自动收敛后的内容"}],
        final_batch=False,
    )

    assert result["ok"] is True
    assert result["applied"][0]["mode"] == "range"
    assert result["applied"][0]["automatic"] is True
    assert result["applied"][0]["anchor_chars"] == 12
    draft = store.outline_draft_path.read_text(encoding="utf-8")
    assert "自动收敛后的内容" in draft
    assert "当前真实内容" not in draft
    assert "不应被修改" in draft


def test_stage_outline_edits_only_blocks_ambiguous_range_anchors(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(
        "重复起点\n内容一\n重复起点\n内容二\n唯一终点\n",
        encoding="utf-8",
    )

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[
            {
                "start_text": "重复起点",
                "end_text": "唯一终点",
                "new_text": "新内容",
            }
        ],
        final_batch=False,
    )

    assert result["ok"] is False
    assert result["error"] == "ambiguous_text_range"
    assert result["details"]["range_count"] == 2
    assert "各增加几个字" in result["message"]
    assert store.outline_draft_path.exists() is False


def test_long_old_text_fallback_stops_when_folded_anchor_is_ambiguous(
    tmp_path: Path,
):
    store = StoryPlanningStore(tmp_path, "demo")
    repeated_start = "S" * 48
    unique_end = "E" * 48
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(
        f"{repeated_start}{'甲' * 60}\n"
        f"{repeated_start}{'乙' * 60}\n"
        f"{'丙' * 60}{unique_end}\n",
        encoding="utf-8",
    )
    inaccurate_old_text = (
        f"{repeated_start}{'错' * 60}\n"
        f"{'模型错误内容' * 20}\n"
        f"{'丙' * 60}{unique_end}"
    )

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": inaccurate_old_text, "new_text": "不应自动写入"}],
        final_batch=False,
    )

    assert result["ok"] is False
    assert result["error"] == "ambiguous_text_range"
    assert result["details"]["anchor_chars"] == 48
    assert result["details"]["start_occurrences"] == 2
    assert store.outline_draft_path.exists() is False


def test_stage_outline_edits_reports_available_headings_for_unknown_section(
    tmp_path: Path,
):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(
        "# 测试小说\n\n### 第一节：开端\n\n旧内容。\n",
        encoding="utf-8",
    )

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"section_heading": "不存在的节", "new_text": "新内容。"}],
        final_batch=False,
    )

    assert result["ok"] is False
    assert result["error"] == "section_heading_not_found"
    assert result["details"]["field_path"] == "$.edits[0].section_heading"
    assert "### 第一节：开端" in result["details"]["available_headings"]
    assert result["details"]["batch_applied"] is False
    assert store.outline_draft_path.exists() is False


def test_stage_outline_edits_rejects_ambiguous_old_text(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text("相同描述\n相同描述\n", encoding="utf-8")

    result = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": "相同描述", "new_text": "新描述"}],
    )

    assert result["ok"] is False
    assert result["error"] == "ambiguous_old_text"
    assert store.outline_draft_path.exists() is False


def test_stage_outline_edits_explains_exact_anchor_mismatch_on_pending_draft(
    tmp_path: Path,
):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(
        "# 大纲\n\n#### 第五章：旧标题\n原始内容。\n\n#### 第六章：后续\n后续内容。\n",
        encoding="utf-8",
    )
    first = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": "# 大纲", "new_text": "# 新大纲"}],
        final_batch=False,
    )

    result = store.stage_outline_edits(
        base_revision=first["draft_revision"],
        edits=[
            {
                "old_text": "#### 第五章：旧标题\n模型记错的内容。",
                "new_text": "#### 第五章：新标题\n新内容。",
            }
        ],
        final_batch=False,
    )

    assert result["error"] == "old_text_not_found"
    assert result["revision"] == first["draft_revision"]
    assert result["details"]["source_kind"] == "pending_draft"
    assert result["details"]["field_path"] == "$.edits[0].old_text"
    assert result["details"]["cause"] == "exact_text_mismatch"
    assert result["details"]["retry_base_revision"] == first["draft_revision"]
    assert result["details"]["anchor"] == "#### 第五章：旧标题"
    assert result["details"]["anchor_line"] == 3
    assert result["details"]["batch_applied"] is False
    assert result["details"]["suggested_old_text"] == (
        "#### 第五章：旧标题\n原始内容。\n\n"
    )
    assert result["details"]["first_difference"]["offset"] > 0
    assert "不要凭记忆重写 old_text" in result["message"]
    assert store.outline_draft_path.read_text(encoding="utf-8").startswith("# 新大纲")


def test_outline_promotion_rejects_source_changed_after_staging(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text("# 原大纲\n", encoding="utf-8")
    staged = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": "原大纲", "new_text": "暂存大纲"}],
    )
    assert staged["ok"] is True

    store.outline_src_path.write_text("# 外部新大纲\n", encoding="utf-8")

    assert store.promote_outline(confirmed=True) is False
    assert store.outline_src_path.read_text(encoding="utf-8") == "# 外部新大纲\n"


def test_multiple_outline_edits_accumulate_on_pending_draft(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text("# 原标题\n\n第一处\n\n第二处\n", encoding="utf-8")

    first = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": "第一处", "new_text": "第一处已改"}],
        batch_label="第一幕",
        final_batch=False,
    )
    snapshot = store.read_outline_for_edit(query="第二处")
    second = store.stage_outline_edits(
        base_revision=first["draft_revision"],
        edits=[{"old_text": "第二处", "new_text": "第二处已改"}],
        batch_label="第二幕",
        final_batch=True,
    )

    assert first["ok"] is True
    assert first["next_action"] == "continue_outline_edit_batches"
    assert first["batch_count"] == 1
    assert first["final_batch"] is False
    assert snapshot["source_kind"] == "pending_draft"
    assert snapshot["pending_batch_count"] == 1
    assert second["ok"] is True
    assert second["next_action"] == "confirm_outline_edits"
    assert second["edit_count"] == 2
    assert second["batch_count"] == 2
    assert second["batch_label"] == "第二幕"
    assert second["final_batch"] is True
    assert store.outline_src_path.read_text(encoding="utf-8") == "# 原标题\n\n第一处\n\n第二处\n"
    draft = store.outline_draft_path.read_text(encoding="utf-8")
    assert "第一处已改" in draft
    assert "第二处已改" in draft


def test_outline_promotion_rejects_an_unfinished_edit_batch(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    original = "# 原大纲\n\n第一幕\n\n第二幕\n"
    store.outline_src_path.write_text(original, encoding="utf-8")

    staged = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": "第一幕", "new_text": "第一幕已改"}],
        batch_label="第一幕",
        final_batch=False,
    )

    assert staged["ok"] is True
    assert store.outline_edit_batches_complete() is False
    assert store.promote_outline(confirmed=True) is False
    assert store.outline_src_path.read_text(encoding="utf-8") == original
    assert "第一幕已改" in store.outline_draft_path.read_text(encoding="utf-8")
    assert store.outline_edit_state_path.exists() is True


def test_outline_edit_batch_limits_ask_agent_to_split_large_changes(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text("# 原大纲\n\n第一幕\n", encoding="utf-8")

    too_many = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": "第一幕", "new_text": f"第{index}幕"} for index in range(9)],
        final_batch=False,
    )
    too_large = store.stage_outline_edits(
        base_revision=store.outline_source_revision(),
        edits=[{"old_text": "第一幕", "new_text": "新" * 12_001}],
        final_batch=False,
    )

    assert too_many["error"] == "too_many_edits"
    assert "最多 4 节" in too_many["message"]
    assert too_large["error"] == "outline_edit_batch_too_large"
    assert "12000" in too_large["message"]
    assert store.outline_draft_path.exists() is False


def test_read_outline_for_edit_returns_query_window_and_full_revision(tmp_path: Path):
    store = StoryPlanningStore(tmp_path, "demo")
    store.outline_src_path.parent.mkdir(parents=True)
    store.outline_src_path.write_text(
        "# 测试\n\n#### 第一章\n内容A\n\n#### 第二章\n内容B\n",
        encoding="utf-8",
    )

    snapshot = store.read_outline_for_edit(query="第二章", context_lines=1)

    assert snapshot["ok"] is True
    assert snapshot["query_found"] is True
    assert "#### 第二章" in snapshot["content"]
    assert snapshot["revision"] == store.outline_source_revision()
