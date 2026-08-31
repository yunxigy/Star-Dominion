from pathlib import Path

import pytest

from tools.library_catalog import (
    describe_document,
    normalize_search_scope,
    query_library,
    scope_for_path,
)


def test_library_catalog_maps_legacy_paths_to_creator_facing_scopes():
    assert scope_for_path("src/story/background.md") == "core"
    assert scope_for_path("src/characters/protagonist.md") == "characters"
    assert scope_for_path("src/world/entities/clocktower.md") == "settings"
    assert scope_for_path("src/progression/clock_sense.yaml") == "settings"
    assert scope_for_path("data/foreshadowing/hooks.md") == "continuity"
    assert scope_for_path("data/manuscript/arc_001/ch_001.md") == "chapters"

    assert normalize_search_scope("story") == "core"
    assert normalize_search_scope("world") == "settings"
    assert normalize_search_scope("assets") == "characters"
    with pytest.raises(ValueError, match="搜索范围无效"):
        normalize_search_scope("unknown")


def test_library_catalog_classifies_structured_assets_and_subcategories():
    protagonist = describe_document(
        "src/characters/lin_cen.md",
        '+++\nid = "lin_cen"\nname = "林岑"\ntier = "主角"\n+++\n',
    )
    faction = describe_document(
        "src/world/entities/night_watch.md",
        '+++\nid = "night_watch"\nname = "守夜人"\nkind = "faction"\n+++\n',
    )
    progression = describe_document(
        "src/progression/clock_sense.yaml",
        "id: clock_sense\nname: 时感\nkind: ability\n",
    )

    assert protagonist.category == "character_main"
    assert protagonist.asset_kind == "character"
    assert protagonist.asset_id == "lin_cen"
    assert protagonist.structured is True
    assert faction.category == "setting_factions"
    assert faction.asset_kind == "world"
    assert progression.category == "setting_systems"
    assert progression.asset_kind == "progression"


def test_library_catalog_keeps_nested_assets_structured_but_indexes_as_raw_documents():
    nested = describe_document(
        "src/world/entities/antagonists/chaos_beast.md",
        '+++\nid = "chaos_beast"\nname = "乱律者"\nkind = "concept"\n+++\n',
    )
    index = describe_document(
        "src/world/entities/_index.md",
        "# 世界观实体总索引\n\n这里汇总各设定入口。\n",
    )

    assert nested.structured is True
    assert nested.asset_kind == "world"
    assert nested.asset_id == "chaos_beast"
    assert index.scope == "settings"
    assert index.structured is False
    assert index.asset_kind == ""
    assert index.asset_id == ""


def test_library_catalog_accepts_unicode_character_ids_and_root_world_documents():
    protagonist = describe_document(
        "src/characters/灵汐.md",
        '+++\nid = "灵汐"\nname = "灵汐"\ntier = "主角"\n+++\n',
    )
    world = describe_document(
        "src/world/rules.md",
        '+++\nid = "world_rules"\nname = "世界规则"\ntype = "world_document"\n+++\n',
    )

    assert protagonist.structured is True
    assert protagonist.asset_kind == "character"
    assert protagonist.asset_id == "灵汐"
    assert world.structured is True
    assert world.asset_kind == "world"
    assert world.asset_id == "world_rules"


def test_query_library_filters_by_scope_category_and_text(tmp_path: Path):
    root = tmp_path / "novel"
    character = root / "src" / "characters" / "lin_cen.md"
    setting = root / "src" / "world" / "entities" / "clocktower.md"
    progression = root / "src" / "progression" / "clock_sense.yaml"
    character.parent.mkdir(parents=True)
    setting.parent.mkdir(parents=True)
    progression.parent.mkdir(parents=True)
    character.write_text(
        '+++\nid = "lin_cen"\nname = "林岑"\ntier = "主角"\nsummary = "寻找失踪旧信"\n+++\n\n# 林岑\n',
        encoding="utf-8",
    )
    setting.write_text(
        '+++\nid = "clocktower"\nname = "旧钟楼"\nkind = "place"\nsummary = "每天少走十三秒"\n+++\n\n# 旧钟楼\n',
        encoding="utf-8",
    )
    progression.write_text(
        "id: clock_sense\nname: 时感\nkind: ability\nsummary: 感知丢失的时间\n",
        encoding="utf-8",
    )

    result = query_library(
        root,
        scope="settings",
        category="setting_places",
        query="十三秒",
    )

    assert result["count"] == 1
    assert result["items"][0]["title"] == "旧钟楼"
    assert result["items"][0]["asset_kind"] == "world"
    assert result["categories"] == [{"id": "setting_places", "label": "地点"}]

    progression_result = query_library(root, scope="settings", query="感知")
    assert progression_result["items"][0]["title"] == "时感"
    assert progression_result["items"][0]["summary"] == "感知丢失的时间"
