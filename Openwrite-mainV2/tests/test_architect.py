import asyncio
from types import SimpleNamespace

from tools.architect import ArchitectAgent


def test_chapter_outline_prompt_renders_dynamic_writing_targets() -> None:
    captured: dict[str, str] = {}

    class FakeClient:
        def chat(self, messages, **_kwargs):
            captured["system"] = messages[0].content
            return SimpleNamespace(content="[]")

    architect = ArchitectAgent(SimpleNamespace(client=FakeClient()))

    assert asyncio.run(architect.generate_outline("测试", "悬疑", "设定", 1)) == []
    assert '"estimated_words": 3000' in captured["system"]
    assert '"summary": "章节内容概要（约180字）"' in captured["system"]


def test_foundation_keeps_core_drafts_when_foreshadowing_generation_fails(
    monkeypatch,
):
    architect = ArchitectAgent(SimpleNamespace())
    monkeypatch.setattr(architect, "_generate_story_bible", lambda *args: "背景")
    monkeypatch.setattr(architect, "_generate_volume_outline", lambda *args: "卷纲")
    monkeypatch.setattr(architect, "_generate_book_rules", lambda *args: "规则")
    monkeypatch.setattr(architect, "_generate_current_state", lambda *args: "状态")

    def fail_foreshadowing(*args):
        raise RuntimeError("provider timeout")

    monkeypatch.setattr(architect, "_generate_foreshadowing_seed", fail_foreshadowing)

    result = architect.generate_foundation("测试书", brief="测试")

    assert result.story_bible == "背景"
    assert result.volume_outline == "卷纲"
    assert result.book_rules == "规则"
    assert result.current_state == "状态"
    assert result.foreshadowing_seed == ""
    assert result.warnings == ["foreshadowing_generation_failed"]


def test_foundation_can_skip_auxiliary_foreshadowing_generation(monkeypatch):
    architect = ArchitectAgent(SimpleNamespace())
    monkeypatch.setattr(architect, "_generate_story_bible", lambda *args: "背景")
    monkeypatch.setattr(architect, "_generate_volume_outline", lambda *args: "卷纲")
    monkeypatch.setattr(architect, "_generate_book_rules", lambda *args: "规则")
    monkeypatch.setattr(architect, "_generate_current_state", lambda *args: "状态")

    def unexpected(*args):
        raise AssertionError("foreshadowing generation should be skipped")

    monkeypatch.setattr(architect, "_generate_foreshadowing_seed", unexpected)

    result = architect.generate_foundation(
        "测试书", brief="测试", include_foreshadowing=False
    )

    assert result.foreshadowing_seed == ""
    assert result.warnings == []
