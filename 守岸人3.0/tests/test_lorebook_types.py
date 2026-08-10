from dataclasses import FrozenInstanceError

import pytest

from server.services.lorebook_types import (
    ActivationRecord,
    EvaluatedEntry,
    LorebookEvaluation,
    LorebookRule,
    TraceRecord,
)


def test_activation_records_are_immutable():
    record = ActivationRecord("entry-1", 2, 4, 3, 1)

    with pytest.raises(FrozenInstanceError):
        record.trigger_sequence = 5


def test_evaluation_exposes_activated_ids_and_prompt_entries():
    rule = LorebookRule(
        id="entry-1",
        content="Black Shores",
        primary_keys=("shore",),
        position="depth",
        depth=3,
        order=7,
    )
    evaluation = LorebookEvaluation(
        entries=[EvaluatedEntry(rule, "matched", 4)],
        trace=[TraceRecord(rule.id, "activated", "matched", estimated_tokens=4)],
        used_tokens=4,
    )

    assert evaluation.activated_ids == ["entry-1"]
    assert evaluation.prompt_entries() == [
        {
            "id": "entry-1",
            "content": "Black Shores",
            "position": "depth",
            "depth": 3,
            "order": 7,
        }
    ]
