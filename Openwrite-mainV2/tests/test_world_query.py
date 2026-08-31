"""WorldQuery 测试

覆盖世界观查询工具的核心功能：
- parse_entity() 解析各种 Markdown 格式
- _parse_relations() 边界情况
- list_entities() 列表与筛选
- get_entity() 获取单个实体
- get_relations_graph() 关系图谱汇总
"""

import sys
import subprocess
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from tools.world_query import (
    parse_entity,
    _parse_relations,
    _normalize_section,
    list_entities,
    get_entity,
    get_relations_graph,
    get_relations_topology,
    get_asset_relation_view,
    edit_world_relation,
    search_relation_targets,
    edit_world_relations,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ── parse_entity ─────────────────────────────────────────────


class TestParseEntity:
    """解析单个 Markdown 实体文件"""

    def test_full_entity(self):
        entity = parse_entity(FIXTURES_DIR / "entity.md")
        assert entity["id"] == "entity"
        assert entity["name"] == "琅琊阁"
        assert entity["type"] == "组织"
        assert entity["subtype"] == "情报机构"
        assert entity["status"] == "active"
        assert "天下第一情报组织" in entity["description"]
        assert len(entity["rules"]) == 3
        assert len(entity["features"]) == 3
        assert len(entity["relations"]) == 3

    def test_minimal_entity(self):
        entity = parse_entity(FIXTURES_DIR / "entity_minimal.md")
        assert entity["name"] == "灵犀玉"
        assert entity["type"] == "物品"
        assert entity["subtype"] == "法器"
        assert entity["rules"] == []
        assert entity["relations"] == []

    def test_entity_without_blockquote(self):
        entity = parse_entity(FIXTURES_DIR / "entity_no_blockquote.md")
        assert entity["name"] == "无名之地"
        assert entity["type"] == ""  # 无 blockquote
        assert len(entity["features"]) == 2

    def test_entity_with_toml_front_matter(self, tmp_path):
        entity_path = tmp_path / "company.md"
        entity_path.write_text(
            """+++
id = "company"
name = "公司（互联网科技公司）"
type = "location"
subtype = "building"
status = "active"
summary = "陈明所在的互联网科技公司，是故事主要发生地。"
tags = ["公司", "都市", "主舞台"]
detail_refs = ["rules", "features", "relations"]

[[related]]
target = "chen_ming"
kind = "employee"
weight = 0.93
note = "主角所在公司"
+++

# 公司（互联网科技公司）

## rules
- 996工作制
- 有监控系统

## features
- 开放式工位

## relations
- zhao_lei — 同组同事
""",
            encoding="utf-8",
        )

        entity = parse_entity(entity_path)
        assert entity["id"] == "company"
        assert entity["name"] == "公司（互联网科技公司）"
        assert entity["type"] == "location"
        assert entity["subtype"] == "building"
        assert entity["status"] == "active"
        assert entity["description"] == "陈明所在的互联网科技公司，是故事主要发生地。"
        assert entity["tags"] == ["公司", "都市", "主舞台"]
        assert entity["detail_refs"] == ["rules", "features", "relations"]
        assert any(rel["target"] == "chen_ming" for rel in entity["relations"])
        assert any(rel["target"] == "zhao_lei" for rel in entity["relations"])

    def test_partial_front_matter_still_reads_legacy_blockquote(self, tmp_path):
        entity_path = tmp_path / "company.md"
        entity_path.write_text(
            """+++
id = "company"
name = "公司"
type = "location"
+++

# 公司

> location | building | active

故事主要发生地。
""",
            encoding="utf-8",
        )

        entity = parse_entity(entity_path)

        assert entity["type"] == "location"
        assert entity["subtype"] == "building"
        assert entity["status"] == "active"
        assert entity["description"] == "故事主要发生地。"


# ── _parse_relations ─────────────────────────────────────────


class TestParseRelations:
    """关联列表解析测试"""

    def test_em_dash_separator(self):
        items = ["张三 — 现任阁主"]
        result = _parse_relations(items)
        assert len(result) == 1
        assert result[0]["target"] == "张三"
        assert result[0]["description"] == "现任阁主"

    def test_hyphen_separator(self):
        items = ["李四 - 敌对关系"]
        result = _parse_relations(items)
        assert result[0]["target"] == "李四"
        assert result[0]["description"] == "敌对关系"

    def test_en_dash_separator(self):
        items = ["王五 – 盟友"]
        result = _parse_relations(items)
        assert result[0]["target"] == "王五"

    def test_no_separator(self):
        items = ["神秘实体"]
        result = _parse_relations(items)
        assert result[0]["target"] == "神秘实体"
        assert result[0]["description"] == ""

    def test_empty_list(self):
        assert _parse_relations([]) == []

    def test_multiple_items(self):
        items = ["A — 关系1", "B — 关系2", "C"]
        result = _parse_relations(items)
        assert len(result) == 3


# ── _normalize_section ───────────────────────────────────────


class TestNormalizeSection:
    def test_known_sections(self):
        assert _normalize_section("规则") == "rules"
        assert _normalize_section("特征") == "features"
        assert _normalize_section("关联") == "relations"

    def test_unknown_section(self):
        assert _normalize_section("其他") == ""
        assert _normalize_section("历史") == ""


# ── list_entities ────────────────────────────────────────────


class TestListEntities:
    """列出实体摘要"""

    @pytest.fixture
    def entity_project(self, tmp_path):
        """创建包含实体文件的项目"""
        entities_dir = tmp_path / "data" / "novels" / "test" / "src" / "world" / "entities"
        entities_dir.mkdir(parents=True)

        (entities_dir / "place_a.md").write_text(
            "# 山海城\n\n> 地点 | 城市 | active\n\n繁华的贸易都市。\n",
            encoding="utf-8",
        )
        (entities_dir / "org_b.md").write_text(
            "# 天山派\n\n> 组织 | 门派 | active\n\n修仙门派。\n",
            encoding="utf-8",
        )
        return tmp_path

    def test_list_all(self, entity_project):
        result = list_entities("test", project_root=entity_project)
        assert len(result) == 2
        names = {e["name"] for e in result}
        assert "山海城" in names
        assert "天山派" in names

    def test_list_by_type(self, entity_project):
        result = list_entities("test", entity_type="组织", project_root=entity_project)
        assert len(result) == 1
        assert result[0]["name"] == "天山派"


def test_world_query_supports_direct_script_execution(tmp_path: Path):
    repo_root = Path(__file__).parent.parent
    script = repo_root / "tools" / "world_query.py"
    entity_path = (
        tmp_path
        / "data"
        / "novels"
        / "script_test"
        / "src"
        / "world"
        / "entities"
        / "company.md"
    )
    entity_path.parent.mkdir(parents=True)
    entity_path.write_text(
        "# 公司（互联网科技公司）\n\n> 地点 | 建筑 | active\n\n故事主要发生地。\n",
        encoding="utf-8",
    )

    result = subprocess.run(
        [
            sys.executable,
            str(script),
            "script_test",
            "company",
            "--project-root",
            str(tmp_path),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "公司（互联网科技公司）" in result.stdout

    def test_list_empty_dir(self, tmp_path):
        entities_dir = tmp_path / "data" / "novels" / "empty" / "src" / "world" / "entities"
        entities_dir.mkdir(parents=True)
        result = list_entities("empty", project_root=tmp_path)
        assert result == []

    def test_list_nonexistent_dir(self, tmp_path):
        result = list_entities("nonexistent", project_root=tmp_path)
        assert result == []

    def test_description_truncation(self, entity_project):
        result = list_entities("test", project_root=entity_project)
        for e in result:
            assert len(e["description"]) <= 63  # 60 + "..."

    def test_list_entities_from_front_matter_summary(self, tmp_path):
        entities_dir = tmp_path / "data" / "novels" / "test" / "src" / "world" / "entities"
        entities_dir.mkdir(parents=True)
        (entities_dir / "company.md").write_text(
            """+++
id = "company"
name = "公司"
type = "location"
subtype = "building"
status = "active"
summary = "陈明所在的互联网科技公司，是故事主要发生地。"
+++

# 公司
""",
            encoding="utf-8",
        )

        result = list_entities("test", project_root=tmp_path)
        assert len(result) == 1
        assert result[0]["name"] == "公司"
        assert result[0]["type"] == "location"
        assert result[0]["description"] == "陈明所在的互联网科技公司，是故事主要发生地。"


# ── get_entity ───────────────────────────────────────────────


class TestGetEntity:
    """获取单个实体详情"""

    @pytest.fixture
    def entity_project(self, tmp_path):
        entities_dir = tmp_path / "data" / "novels" / "test" / "src" / "world" / "entities"
        entities_dir.mkdir(parents=True)
        (entities_dir / "item_x.md").write_text(
            "# 天命之剑\n\n> 物品 | 武器 | active\n\n传说中的神兵。\n\n## 规则\n\n- 只有天命之人能拔出\n",
            encoding="utf-8",
        )
        return tmp_path

    def test_get_existing_entity(self, entity_project):
        entity = get_entity("test", "item_x", project_root=entity_project)
        assert entity is not None
        assert entity["name"] == "天命之剑"
        assert entity["type"] == "物品"
        assert len(entity["rules"]) == 1

    def test_get_nonexistent_entity(self, entity_project):
        assert get_entity("test", "nope", project_root=entity_project) is None


# ── get_relations_graph ──────────────────────────────────────


class TestGetRelationsGraph:
    """关系图谱汇总测试"""

    @pytest.fixture
    def relation_project(self, tmp_path):
        entities_dir = tmp_path / "data" / "novels" / "test" / "src" / "world" / "entities"
        entities_dir.mkdir(parents=True)

        (entities_dir / "a.md").write_text(
            "# 实体A\n\n> 概念 | | active\n\n描述A\n\n## 关联\n\n- b — 依赖\n",
            encoding="utf-8",
        )
        (entities_dir / "b.md").write_text(
            "# 实体B\n\n> 概念 | | active\n\n描述B\n\n## 关联\n\n- a — 被依赖\n",
            encoding="utf-8",
        )
        return tmp_path

    def test_graph_structure(self, relation_project):
        graph = get_relations_graph("test", project_root=relation_project)
        assert "a" in graph["entities"]
        assert "b" in graph["entities"]
        assert len(graph["relations"]) == 2

    def test_graph_empty_dir(self, tmp_path):
        graph = get_relations_graph("nonexistent", project_root=tmp_path)
        assert graph == {"entities": [], "relations": []}

    def test_relation_details(self, relation_project):
        graph = get_relations_graph("test", project_root=relation_project)
        a_to_b = [r for r in graph["relations"] if r["source"] == "a" and r["target"] == "b"]
        assert len(a_to_b) == 1
        assert a_to_b[0]["description"] == "依赖"

    def test_graph_supports_front_matter_related_entries(self, tmp_path):
        entities_dir = tmp_path / "data" / "novels" / "test" / "src" / "world" / "entities"
        entities_dir.mkdir(parents=True)
        (entities_dir / "company.md").write_text(
            """+++
id = "company"
name = "公司"
type = "location"
subtype = "building"
status = "active"
summary = "主舞台"

[[related]]
target = "chen_ming"
kind = "employee"
weight = 0.91
note = "主角所在公司"
+++

# 公司
""",
            encoding="utf-8",
        )

        graph = get_relations_graph("test", project_root=tmp_path)
        assert graph["entities"] == ["company"]
        assert graph["relations"][0]["target"] == "chen_ming"
        assert graph["relations"][0]["description"] == "主角所在公司"

    def test_graph_deduplicates_front_matter_and_section_relations(self, tmp_path):
        entities_dir = tmp_path / "data" / "novels" / "test" / "src" / "world" / "entities"
        entities_dir.mkdir(parents=True)
        (entities_dir / "company.md").write_text(
            """+++
id = "company"
name = "公司"
type = "location"
subtype = "building"

[[related]]
target = "chen_ming"
kind = "employee"
note = "主角所在公司"
+++

# 公司

## 关联
- chen_ming — 主角所在公司
""",
            encoding="utf-8",
        )

        graph = get_relations_graph("test", project_root=tmp_path)

        assert len(graph["relations"]) == 1
        assert graph["relations"][0] == {
            "source": "company",
            "target": "chen_ming",
            "description": "主角所在公司",
        }


class TestGetRelationsTopology:
    def test_nested_entities_are_included_in_all_query_surfaces(self, tmp_path):
        entities = (
            tmp_path
            / "data"
            / "novels"
            / "test"
            / "src"
            / "world"
            / "entities"
            / "factions"
        )
        entities.mkdir(parents=True)
        (entities / "night_watch.md").write_text(
            "# 守夜会\n\n> 势力 | 公会 | active\n\n维护港口秩序。\n",
            encoding="utf-8",
        )

        assert list_entities("test", project_root=tmp_path)[0]["id"] == "night_watch"
        assert get_entity("test", "night_watch", project_root=tmp_path)["name"] == "守夜会"
        assert get_relations_graph("test", project_root=tmp_path)["entities"] == [
            "night_watch"
        ]
        topology = get_relations_topology("test", project_root=tmp_path)
        assert topology["nodes"][0]["id"] == "night_watch"
        assert topology["nodes"][0]["kind"] == "faction"

    def test_topology_combines_character_and_world_relations(self, tmp_path):
        root = tmp_path / "data" / "novels" / "test" / "src"
        world = root / "world" / "entities"
        characters = root / "characters"
        world.mkdir(parents=True)
        characters.mkdir(parents=True)
        (world / "harbor.md").write_text(
            "# 雾港\n\n> 地点 | 港口 | active\n\n故事起点。\n\n//**雾港~>林岑:常驻**\n",
            encoding="utf-8",
        )
        (characters / "lin.md").write_text(
            """+++
id = "char_lin"
name = "林岑"
summary = "追查失踪案的记者。"

[[related]]
target = "harbor"
kind = "works_at"
note = "长期调查"
+++
# 林岑
""",
            encoding="utf-8",
        )

        topology = get_relations_topology("test", project_root=tmp_path)

        assert {node["id"] for node in topology["nodes"]} == {"harbor", "char_lin"}
        assert {node["kind"] for node in topology["nodes"]} == {"place", "character"}
        assert len(topology["edges"]) == 2
        assert topology["nodes"][0]["source_path"].startswith("data/novels/test/src/")

    def test_topology_exposes_unresolved_targets_and_limits(self, tmp_path):
        world = tmp_path / "data" / "novels" / "test" / "src" / "world" / "entities"
        world.mkdir(parents=True)
        (world / "a.md").write_text(
            "# A\n\n> 概念 | | active\n\n//**A~>missing:尚未归档**\n",
            encoding="utf-8",
        )

        topology = get_relations_topology(
            "test", project_root=tmp_path, max_nodes=1, max_edges=0
        )

        assert len(topology["nodes"]) == 1
        assert topology["edges"] == []
        assert topology["totals"] == {"nodes": 2, "edges": 1}
        assert topology["truncated"] is True
        assert topology["diagnostics"][0]["code"] == "relation_target_unresolved"

    def test_topology_ignores_unregistered_character_relationship_sections(self, tmp_path):
        characters = tmp_path / "data" / "novels" / "test" / "src" / "characters"
        characters.mkdir(parents=True)
        (characters / "hero.md").write_text(
            """+++
id = "hero"
name = "林舟"
role = "主角"
+++

# 林舟

## 关系网络
- **苏遥**：共同调查旧案
- **周策（老周）**：mentor，曾救过他
""",
            encoding="utf-8",
        )
        (characters / "su_yao.md").write_text(
            """+++
id = "su_yao"
name = "苏遥"
+++

# 苏遥

## 与主角的关系
从互相怀疑逐渐变成可靠搭档。
""",
            encoding="utf-8",
        )
        (characters / "zhou_ce.md").write_text(
            """+++
id = "zhou_ce"
name = "周策"
+++

# 周策

## 与林舟的羁绊
旧案让两人形成亦师亦友的关系。
""",
            encoding="utf-8",
        )

        topology = get_relations_topology("test", project_root=tmp_path)
        assert topology["edges"] == []
        assert topology["relation_totals"] == {"canonical": 0, "annotation": 0}

    def test_asset_relation_view_uses_same_resolved_edges_and_provenance(self, tmp_path):
        characters = tmp_path / "data" / "novels" / "test" / "src" / "characters"
        characters.mkdir(parents=True)
        (characters / "hero.md").write_text(
            """+++
id = "hero"
name = "林舟"

[[related]]
target = "partner"
kind = "ally"
note = "共同调查"
+++

# 林舟

## 关系网络
- **苏遥**：正文中的重复描述
- **周策（老周）**：普通正文描述

//**林舟~>周策:曾经的导师**
""",
            encoding="utf-8",
        )
        (characters / "partner.md").write_text(
            '+++\nid = "partner"\nname = "苏遥"\n+++\n\n# 苏遥\n',
            encoding="utf-8",
        )
        (characters / "mentor.md").write_text(
            '+++\nid = "mentor"\nname = "周策"\n+++\n\n# 周策\n',
            encoding="utf-8",
        )

        topology = get_relations_topology("test", project_root=tmp_path)
        view = get_asset_relation_view(
            "test", "hero", project_root=tmp_path, asset_kind="character"
        )
        incoming = get_asset_relation_view(
            "test", "partner", project_root=tmp_path, asset_kind="character"
        )

        assert topology["relation_totals"] == {"canonical": 1, "annotation": 1}
        assert [(item["target"], item["kind"]) for item in view["confirmed"]] == [
            ("partner", "ally")
        ]
        assert [(item["target"], item["origin"]) for item in view["registered"]] == [
            ("mentor", "annotation")
        ]
        assert incoming["incoming"][0]["target"] == "hero"
        assert incoming["incoming"][0]["origin"] == "canonical"

    def test_manuscript_relation_overrides_outline_annotation(self, tmp_path):
        novel = tmp_path / "data" / "novels" / "test"
        world = novel / "src" / "world" / "entities"
        manuscript = novel / "data" / "manuscript" / "arc_001"
        world.mkdir(parents=True)
        manuscript.mkdir(parents=True)
        (world / "a.md").write_text("# A\n\n> 概念 | | active\n", encoding="utf-8")
        (world / "b.md").write_text("# B\n\n> 概念 | | active\n", encoding="utf-8")
        (novel / "src" / "outline.md").write_text(
            "#### 第一章\n//**A~>B:计划合作**\n", encoding="utf-8"
        )
        (manuscript / "ch_001.md").write_text(
            "# 第一章\n//**A~>B:实际敌对**\n", encoding="utf-8"
        )

        topology = get_relations_topology("test", project_root=tmp_path)

        edge = topology["edges"][0]
        assert edge["label"] == "实际敌对"
        assert edge["source_label"].startswith("正文注册 · ")

    def test_legacy_string_related_entries_are_confirmed_edges(self, tmp_path):
        world = tmp_path / "data" / "novels" / "test" / "src" / "world" / "entities"
        world.mkdir(parents=True)
        (world / "market.md").write_text(
            '+++\nid = "market"\nname = "市集"\nrelated = ["港口"]\n+++\n\n# 市集\n',
            encoding="utf-8",
        )
        (world / "harbor.md").write_text(
            '+++\nid = "harbor"\nname = "港口"\n+++\n\n# 港口\n',
            encoding="utf-8",
        )

        topology = get_relations_topology("test", project_root=tmp_path)

        assert topology["edges"][0]["source"] == "market"
        assert topology["edges"][0]["target"] == "harbor"
        assert topology["edges"][0]["origin"] == "canonical"


class TestEditWorldRelation:
    @pytest.fixture
    def relation_project(self, tmp_path):
        characters = tmp_path / "data" / "novels" / "test" / "src" / "characters"
        characters.mkdir(parents=True)
        (characters / "hero.md").write_text(
            """+++
id = "hero"
name = "林舟"
role = "主角"
summary = "追查旧案。"
+++

# 林舟

正文保持原样。
""",
            encoding="utf-8",
        )
        (characters / "partner.md").write_text(
            """+++
id = "partner"
name = "苏遥"
+++

# 苏遥
""",
            encoding="utf-8",
        )
        return tmp_path

    def test_preview_then_confirm_writes_canonical_relation(self, relation_project):
        source = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "characters"
            / "hero.md"
        )
        original = source.read_text(encoding="utf-8")

        preview = edit_world_relation(
            "test",
            "林舟",
            "苏遥",
            "并肩调查旧案",
            project_root=relation_project,
        )

        assert preview["ok"] is True
        assert preview["applied"] is False
        assert preview["changed"] is True
        assert "[[related]]" in preview["diff"]
        assert source.read_text(encoding="utf-8") == original

        applied = edit_world_relation(
            "test",
            "hero",
            "partner",
            "并肩调查旧案",
            project_root=relation_project,
            base_revision=preview["base_revision"],
            confirm=True,
        )

        assert applied["ok"] is True
        assert applied["applied"] is True
        updated = source.read_text(encoding="utf-8")
        assert 'target = "partner"' in updated
        assert 'note = "并肩调查旧案"' in updated
        assert "正文保持原样。" in updated
        topology = get_relations_topology("test", project_root=relation_project)
        assert any(
            edge["source"] == "hero" and edge["target"] == "partner"
            for edge in topology["edges"]
        )

    def test_relation_edit_preserves_legacy_string_targets(self, relation_project):
        characters = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "characters"
        )
        source = characters / "hero.md"
        source.write_text(
            source.read_text(encoding="utf-8").replace(
                'summary = "追查旧案。"',
                'summary = "追查旧案。"\nrelated = ["旧识"]',
            ),
            encoding="utf-8",
        )
        (characters / "old_friend.md").write_text(
            '+++\nid = "old_friend"\nname = "旧识"\n+++\n\n# 旧识\n',
            encoding="utf-8",
        )

        preview = edit_world_relation(
            "test", "hero", "partner", "搭档", project_root=relation_project
        )
        applied = edit_world_relation(
            "test",
            "hero",
            "partner",
            "搭档",
            project_root=relation_project,
            base_revision=preview["base_revision"],
            confirm=True,
        )

        assert applied["ok"] is True
        updated = source.read_text(encoding="utf-8")
        assert 'target = "旧识"' in updated
        assert 'target = "partner"' in updated

    def test_relation_upsert_replaces_legacy_label_for_confirmed_entity(
        self, relation_project
    ):
        characters = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "characters"
        )
        source = characters / "hero.md"
        source.write_text(
            source.read_text(encoding="utf-8").replace(
                'summary = "追查旧案。"',
                'summary = "追查旧案。"\nrelated = ["旧识搭档", "旧案地点"]',
            ),
            encoding="utf-8",
        )
        (characters / "old_friend.md").write_text(
            '+++\nid = "old_friend"\nname = "旧识搭档与前线伙伴"\n+++'
            '\n\n# 旧识搭档与前线伙伴\n',
            encoding="utf-8",
        )

        preview = edit_world_relation(
            "test", "hero", "old_friend", "昔日搭档", project_root=relation_project
        )
        applied = edit_world_relation(
            "test",
            "hero",
            "old_friend",
            "昔日搭档",
            project_root=relation_project,
            base_revision=preview["base_revision"],
            confirm=True,
        )

        assert applied["ok"] is True
        updated = source.read_text(encoding="utf-8")
        assert 'target = "old_friend"' in updated
        assert 'target = "旧识搭档"' not in updated
        assert 'target = "旧案地点"' in updated

    def test_search_relation_targets_finds_characters_and_world_entities(
        self, relation_project
    ):
        entities = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "world"
            / "entities"
        )
        entities.mkdir(parents=True)
        (entities / "birth_city.md").write_text(
            """+++
id = "birth_city"
name = "雾都转轮府"
type = "地点"
subtype = "出身地"
summary = "林舟的出身地点，旧案线索最早在这里断裂。"
+++

# 雾都转轮府

林舟在这里长大，掌握了第一批关于旧案的线索。
""",
            encoding="utf-8",
        )

        result = search_relation_targets(
            "test",
            "林舟 出身 雾都",
            project_root=relation_project,
            limit=10,
        )
        ids = {candidate["id"] for candidate in result["candidates"]}

        assert result["count"] >= 2
        assert {"hero", "birth_city"}.issubset(ids)
        birth_city = next(
            candidate
            for candidate in result["candidates"]
            if candidate["id"] == "birth_city"
        )
        assert birth_city["type"] == "地点"
        assert "出身" in birth_city["matched_terms"]

    def test_batch_relation_preview_and_confirm_writes_multiple_edges(
        self, relation_project
    ):
        entities = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "world"
            / "entities"
        )
        entities.mkdir(parents=True)
        (entities / "birth_city.md").write_text(
            """+++
id = "birth_city"
name = "雾都转轮府"
type = "地点"
summary = "林舟的出身地点。"
+++

# 雾都转轮府
""",
            encoding="utf-8",
        )
        (entities / "echo_ability.md").write_text(
            """+++
id = "echo_ability"
name = "回响感知"
type = "能力"
summary = "能够察觉旧案残留的异常回响。"
+++

# 回响感知
""",
            encoding="utf-8",
        )
        source = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "characters"
            / "hero.md"
        )
        original = source.read_text(encoding="utf-8")
        relations = [
            {
                "source_id": "hero",
                "target_id": "birth_city",
                "description": "出身地",
            },
            {
                "source_id": "hero",
                "target_id": "echo_ability",
                "description": "核心能力",
            },
        ]

        preview = edit_world_relations(
            "test",
            relations,
            project_root=relation_project,
        )

        assert preview["ok"] is True
        assert preview["applied"] is False
        assert preview["changed_sources"] == 1
        assert "[[related]]" in preview["diff"]
        assert 'target = "birth_city"' in preview["diff"]
        assert 'target = "echo_ability"' in preview["diff"]
        assert preview["source_revisions"]["hero"]
        assert preview["preview_token"]
        assert source.read_text(encoding="utf-8") == original

        applied = edit_world_relations(
            "test",
            [{"source_id": "模型重新生成的错误实体", "target_id": "partner"}],
            project_root=relation_project,
            preview_token=preview["preview_token"],
            confirm=True,
        )

        assert applied["ok"] is True
        assert applied["applied"] is True
        updated = source.read_text(encoding="utf-8")
        assert 'target = "birth_city"' in updated
        assert 'target = "echo_ability"' in updated
        topology = get_relations_topology("test", project_root=relation_project)
        edges = {
            (edge["source"], edge["target"])
            for edge in topology["edges"]
        }
        assert ("hero", "birth_city") in edges
        assert ("hero", "echo_ability") in edges
        reused = edit_world_relations(
            "test",
            project_root=relation_project,
            preview_token=preview["preview_token"],
            confirm=True,
        )
        assert reused["ok"] is False
        assert "已使用" in reused["error"]

    def test_missing_relation_entity_suggests_canonical_name_and_id(
        self, relation_project
    ):
        entities = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "world"
            / "entities"
        )
        entities.mkdir(parents=True)
        (entities / "bamu_canji.md").write_text(
            """+++
id = "bamu_canji"
name = "魃母残脊"
alias = "妖魃遗骸"
+++

# 妖魃遗骸·魃母残脊
""",
            encoding="utf-8",
        )

        result = edit_world_relations(
            "test",
            [{"source_id": "骼母残脊", "target_id": "partner"}],
            project_root=relation_project,
        )

        assert result["ok"] is False
        assert "第 1 条关系源实体不存在: 骼母残脊" in result["error"]
        assert "魃母残脊（ID: bamu_canji）" in result["error"]

    def test_confirmation_combines_multiple_immutable_previews(self, relation_project):
        first = edit_world_relations(
            "test",
            [{"source_id": "hero", "target_id": "partner", "description": "搭档"}],
            project_root=relation_project,
        )
        second = edit_world_relations(
            "test",
            [{"source_id": "partner", "target_id": "hero", "description": "搭档"}],
            project_root=relation_project,
        )

        applied = edit_world_relations(
            "test",
            project_root=relation_project,
            preview_tokens=[first["preview_token"], second["preview_token"]],
            confirm=True,
        )

        assert applied["ok"] is True
        assert applied["applied"] is True
        character_root = (
            relation_project / "data" / "novels" / "test" / "src" / "characters"
        )
        assert 'target = "partner"' in (character_root / "hero.md").read_text(
            encoding="utf-8"
        )
        assert 'target = "hero"' in (character_root / "partner.md").read_text(
            encoding="utf-8"
        )

    def test_tampered_relation_preview_is_rejected(self, relation_project):
        source = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "characters"
            / "hero.md"
        )
        original = source.read_text(encoding="utf-8")
        preview = edit_world_relations(
            "test",
            [{"source_id": "hero", "target_id": "partner"}],
            project_root=relation_project,
        )
        preview_path = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "data"
            / "workflows"
            / "relation_previews"
            / f"{preview['preview_token']}.json"
        )
        preview_path.write_text(
            preview_path.read_text(encoding="utf-8").replace('"partner"', '"hero"'),
            encoding="utf-8",
        )

        result = edit_world_relations(
            "test",
            project_root=relation_project,
            preview_token=preview["preview_token"],
            confirm=True,
        )

        assert result["ok"] is False
        assert "校验失败" in result["error"]
        assert source.read_text(encoding="utf-8") == original

    def test_confirmation_rejects_stale_revision(self, relation_project):
        source = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "characters"
            / "hero.md"
        )
        preview = edit_world_relation(
            "test", "hero", "partner", "盟友", project_root=relation_project
        )
        source.write_text(source.read_text(encoding="utf-8") + "\n外部修改。\n", encoding="utf-8")

        result = edit_world_relation(
            "test",
            "hero",
            "partner",
            "盟友",
            project_root=relation_project,
            base_revision=preview["base_revision"],
            confirm=True,
        )

        assert result["ok"] is False
        assert result["applied"] is False
        assert result["error"] == "relation_revision_conflict"
        assert "[[related]]" not in source.read_text(encoding="utf-8")

    def test_remove_requires_preview_and_confirmation(self, relation_project):
        add_preview = edit_world_relation(
            "test", "hero", "partner", "盟友", project_root=relation_project
        )
        edit_world_relation(
            "test",
            "hero",
            "partner",
            "盟友",
            project_root=relation_project,
            base_revision=add_preview["base_revision"],
            confirm=True,
        )
        source = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "characters"
            / "hero.md"
        )
        with_relation = source.read_text(encoding="utf-8")

        remove_preview = edit_world_relation(
            "test",
            "hero",
            "partner",
            "",
            project_root=relation_project,
            action="remove",
        )
        assert remove_preview["changed"] is True
        assert source.read_text(encoding="utf-8") == with_relation

        removed = edit_world_relation(
            "test",
            "hero",
            "partner",
            "",
            project_root=relation_project,
            action="remove",
            base_revision=remove_preview["base_revision"],
            confirm=True,
        )
        assert removed["applied"] is True
        assert "[[related]]" not in source.read_text(encoding="utf-8")

    def test_rejects_missing_entities_and_self_relation(self, relation_project):
        missing = edit_world_relation(
            "test", "missing", "partner", "", project_root=relation_project
        )
        self_relation = edit_world_relation(
            "test", "hero", "林舟", "", project_root=relation_project
        )

        assert missing["ok"] is False
        assert "不存在" in missing["error"]
        assert self_relation["ok"] is False
        assert "不能相同" in self_relation["error"]

    def test_removing_absent_relation_is_a_noop(self, relation_project):
        source = (
            relation_project
            / "data"
            / "novels"
            / "test"
            / "src"
            / "characters"
            / "hero.md"
        )
        original = source.read_text(encoding="utf-8")

        result = edit_world_relation(
            "test",
            "hero",
            "partner",
            "",
            project_root=relation_project,
            action="remove",
        )

        assert result["ok"] is True
        assert result["changed"] is False
        assert result["diff"] == ""
        assert source.read_text(encoding="utf-8") == original
