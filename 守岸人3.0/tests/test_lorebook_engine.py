from server.services.lorebook_engine import LorebookEngine
from server.services.lorebook_types import LorebookRule


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
