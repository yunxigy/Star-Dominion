from server.services.lorebook_engine import LorebookEngine
from server.services.lorebook_types import ActivationRecord, LorebookRule


def test_scan_depth_constant_probability_delay_and_trace():
    rules = [
        LorebookRule("constant", "always", (), constant=True),
        LorebookRule("history", "found", ("old clue",)),
        LorebookRule("delayed", "later", ("now",), delay=6),
        LorebookRule("rolled-out", "chance", ("now",), probability=0.2),
    ]

    result = LorebookEngine(random_value=lambda: 0.8).evaluate(
        rules=rules,
        history=[
            {"role": "user", "content": "old clue"},
            {"role": "assistant", "content": "noted"},
        ],
        current_input="now",
        scan_depth=2,
        current_sequence=3,
        token_budget=100,
    )

    assert result.activated_ids == ["constant", "history"]
    reasons = {item.entry_id: item.reason for item in result.trace}
    assert reasons["delayed"] == "delay_not_reached"
    assert reasons["rolled-out"] == "probability_rejected"


def test_recursion_group_and_sticky_effects():
    rules = [
        LorebookRule("seed", "Rufus is nearby", ("Bessie",), priority=10),
        LorebookRule("recursive", "Rufus is a dog", ("Rufus",), priority=9),
        LorebookRule(
            "group-a",
            "A",
            ("choice",),
            group="scene",
            group_weight=10,
        ),
        LorebookRule(
            "group-b",
            "B",
            ("choice",),
            group="scene",
            group_weight=90,
        ),
        LorebookRule(
            "sticky",
            "stays",
            ("gone",),
            sticky=3,
            cooldown=2,
            revision=2,
        ),
    ]
    prior = [ActivationRecord("sticky", 2, trigger_sequence=4, sticky=3, cooldown=2)]

    result = LorebookEngine(random_value=lambda: 0.5).evaluate(
        rules=rules,
        history=[],
        current_input="Bessie choice",
        scan_depth=2,
        current_sequence=6,
        token_budget=100,
        prior_activations=prior,
        recursive_scan=True,
        max_recursion_steps=3,
    )

    assert "recursive" in result.activated_ids
    assert "group-b" in result.activated_ids
    assert "group-a" not in result.activated_ids
    assert "sticky" in result.activated_ids


def test_cooldown_and_revision_change_clear_timed_state():
    item = LorebookRule(
        "entry",
        "content",
        ("absent",),
        sticky=1,
        cooldown=2,
        revision=3,
    )
    stale = ActivationRecord("entry", 2, 4, 1, 2)
    current = ActivationRecord("entry", 3, 4, 1, 2)
    engine = LorebookEngine(random_value=lambda: 0.0)

    stale_result = engine.evaluate(
        rules=[item],
        history=[],
        current_input="none",
        scan_depth=1,
        current_sequence=5,
        token_budget=100,
        prior_activations=[stale],
    )
    current_result = engine.evaluate(
        rules=[item],
        history=[],
        current_input="none",
        scan_depth=1,
        current_sequence=6,
        token_budget=100,
        prior_activations=[current],
    )

    assert stale_result.activated_ids == []
    assert {trace.reason for trace in current_result.trace} == {"cooldown_active"}


def test_recursion_flags_control_expansion():
    rules = [
        LorebookRule("seed", "hidden clue", ("start",)),
        LorebookRule("recursive-only", "found", ("hidden clue",), recursion_only=True),
        LorebookRule("excluded", "must stay out", ("hidden clue",), exclude_recursion=True),
        LorebookRule("stop", "blocked clue", ("stop",), prevent_recursion=True),
        LorebookRule("blocked", "must stay out", ("blocked clue",)),
    ]

    result = LorebookEngine(random_value=lambda: 0.0).evaluate(
        rules=rules,
        history=[],
        current_input="start stop",
        scan_depth=1,
        current_sequence=1,
        token_budget=100,
        recursive_scan=True,
        max_recursion_steps=3,
    )

    assert "recursive-only" in result.activated_ids
    assert "excluded" not in result.activated_ids
    assert "blocked" not in result.activated_ids


def test_prioritized_group_uses_stable_priority_order():
    rules = [
        LorebookRule(
            "lower",
            "lower",
            ("pick",),
            priority=1,
            group="scene",
            group_prioritized=True,
        ),
        LorebookRule(
            "higher",
            "higher",
            ("pick",),
            priority=5,
            group="scene",
        ),
    ]

    result = LorebookEngine(random_value=lambda: 0.99).evaluate(
        rules=rules,
        history=[],
        current_input="pick",
        scan_depth=1,
        current_sequence=1,
        token_budget=100,
    )

    assert result.activated_ids == ["higher"]


def test_recursion_only_entry_still_respects_delay():
    rules = [
        LorebookRule("seed", "future clue", ("start",)),
        LorebookRule(
            "delayed-recursive",
            "too early",
            ("future clue",),
            recursion_only=True,
            delay=5,
        ),
    ]

    result = LorebookEngine(random_value=lambda: 0.0).evaluate(
        rules=rules,
        history=[],
        current_input="start",
        scan_depth=1,
        current_sequence=2,
        token_budget=100,
    )

    assert "delayed-recursive" not in result.activated_ids
    assert any(
        trace.entry_id == "delayed-recursive" and trace.reason == "delay_not_reached"
        for trace in result.trace
    )


def test_token_budget_rejection_is_visible_in_trace():
    item = LorebookRule("large", "abcdefgh", ("match",))

    result = LorebookEngine(random_value=lambda: 0.0).evaluate(
        rules=[item],
        history=[],
        current_input="match",
        scan_depth=1,
        current_sequence=1,
        token_budget=1,
    )

    assert result.activated_ids == []
    assert result.trace[-1].reason == "token_budget_exceeded"
    assert result.trace[-1].estimated_tokens == 2
