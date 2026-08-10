# ShouAnRen Lorebook Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the inline five-entry keyword scan with a deterministic, testable Lorebook engine that supports advanced matching, recursion, timed effects, groups, token budgets, prompt positions, debugging, and branch-aware runtime history.

**Architecture:** Keep rule evaluation pure and independent from FastAPI/SQLAlchemy, then adapt database models through a runtime service. Persist activation events against assistant response messages so an active chat path naturally inherits or discards timed effects when branches change. The chat router delegates evaluation and prompt injection to the new services; a dedicated management page exposes all settings and dry-run traces.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, SQLAlchemy, SQLite/PostgreSQL-compatible additive migrations, native HTML/CSS/JavaScript, pytest.

---

## Clean-room constraint

Implement this plan from the approved project specification and tests. Do not copy or adapt SillyTavern source, tests, comments, assets, or UI text. `SillyTavern/` must not become an import, runtime, build, test, or deployment dependency.

## File map

- Create `守岸人3.0/server/services/lorebook_types.py`: immutable rule inputs, activation records, trace records, and evaluation output.
- Create `守岸人3.0/server/services/lorebook_matcher.py`: keyword parsing and matching without database access.
- Create `守岸人3.0/server/services/lorebook_engine.py`: scan, timed effects, recursion, grouping, sorting, budgeting, and trace generation.
- Create `守岸人3.0/server/services/lorebook_runtime.py`: load SQLAlchemy rows, load active-path events, evaluate, and persist successful activation events.
- Modify `守岸人3.0/server/models/lorebook.py`: advanced settings, scope bindings, entry revisions, and activation events.
- Modify `守岸人3.0/server/migrations.py`: bump schema version from 2 to 3.
- Modify `守岸人3.0/server/database.py`: add advanced columns and create the activation-event table.
- Modify `守岸人3.0/server/routers/lorebook.py`: validate advanced settings and provide a dry-run debug endpoint.
- Modify `守岸人3.0/server/routers/chat.py`: remove inline matching and use the runtime engine for normal generation and regeneration.
- Modify `守岸人3.0/server/utils/prompt_builder.py`: consume evaluated entries at all three injection positions.
- Create `守岸人3.0/frontend/lorebooks.html`: worldbook and rule management UI.
- Create `守岸人3.0/frontend/js/lorebooks.js`: API loading, editing, validation, sorting, and debugger rendering.
- Modify `守岸人3.0/frontend/characters.html`: add an owned-character worldbook action.
- Create `守岸人3.0/tests/test_lorebook_matcher.py`: pure matcher regressions.
- Create `守岸人3.0/tests/test_lorebook_engine.py`: rule evaluation, recursion, group, timed-effect, budget, and trace regressions.
- Create `守岸人3.0/tests/test_lorebook_runtime.py`: database mapping, active-path inheritance, and event persistence regressions.
- Create `守岸人3.0/tests/test_lorebook_api.py`: authorization, validation, debug, and chat integration regressions.
- Create `守岸人3.0/tests/test_lorebook_frontend_contract.py`: management-page contract tests.
- Modify `守岸人3.0/server/tests/test_database_migrations.py`: schema-version-3 contract.
- Modify `守岸人3.0/README.md`: document actual worldbook behavior and clean-room compatibility scope.

### Task 1: Domain Types and Keyword Matcher

**Files:**
- Create: `守岸人3.0/server/services/lorebook_types.py`
- Create: `守岸人3.0/server/services/lorebook_matcher.py`
- Create: `守岸人3.0/tests/test_lorebook_matcher.py`

- [x] **Step 1: Write failing matcher tests**

```python
from server.services.lorebook_matcher import match_rule
from server.services.lorebook_types import LorebookRule


def rule(**overrides):
    values = {
        "id": "entry-1",
        "content": "Black Shores",
        "primary_keys": ("shore",),
        "secondary_keys": (),
    }
    values.update(overrides)
    return LorebookRule(**values)


def test_selective_and_requires_primary_and_secondary():
    item = rule(secondary_keys=("rover",), selective_logic="and")
    assert match_rule(item, "the rover reached the shore").matched is True
    assert match_rule(item, "the shore is quiet").reason == "secondary_not_matched"


def test_case_whole_word_and_regex_are_explicit():
    assert match_rule(rule(case_sensitive=True), "SHORE").matched is False
    assert match_rule(rule(match_whole_words=True), "offshore").matched is False
    assert match_rule(rule(primary_keys=("/shores?$/",)), "black shore").matched is True


def test_invalid_regex_is_isolated():
    result = match_rule(rule(primary_keys=("/[invalid/",)), "anything")
    assert result.matched is False
    assert result.error == "invalid_regular_expression"
```

- [x] **Step 2: Run tests and verify the missing-module failure**

Run: `python -m pytest -q tests/test_lorebook_matcher.py`

Expected: FAIL because `server.services.lorebook_matcher` does not exist.

- [x] **Step 3: Add immutable domain types**

```python
# server/services/lorebook_types.py
from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class LorebookRule:
    id: str
    content: str
    primary_keys: tuple[str, ...]
    secondary_keys: tuple[str, ...] = ()
    selective_logic: Literal["and", "or"] = "or"
    constant: bool = False
    position: Literal["before_char", "after_char", "depth"] = "after_char"
    depth: int = 4
    order: int = 0
    priority: int = 0
    probability: float = 1.0
    sticky: int = 0
    cooldown: int = 0
    delay: int = 0
    group: str | None = None
    group_weight: int = 100
    group_prioritized: bool = False
    case_sensitive: bool = False
    match_whole_words: bool = False
    exclude_recursion: bool = False
    prevent_recursion: bool = False
    recursion_only: bool = False
    revision: int = 1


@dataclass(frozen=True)
class MatchResult:
    matched: bool
    reason: str
    matched_keys: tuple[str, ...] = ()
    error: str | None = None


@dataclass(frozen=True)
class ActivationRecord:
    entry_id: str
    entry_revision: int
    trigger_sequence: int
    sticky: int
    cooldown: int


@dataclass(frozen=True)
class EvaluatedEntry:
    rule: LorebookRule
    activation_reason: str
    estimated_tokens: int


@dataclass(frozen=True)
class TraceRecord:
    entry_id: str
    status: str
    reason: str
    recursion_level: int = 0
    estimated_tokens: int = 0


@dataclass
class LorebookEvaluation:
    entries: list[EvaluatedEntry] = field(default_factory=list)
    trace: list[TraceRecord] = field(default_factory=list)
    used_tokens: int = 0

    @property
    def activated_ids(self) -> list[str]:
        return [item.rule.id for item in self.entries]

    def prompt_entries(self) -> list[dict]:
        return [
            {
                "id": item.rule.id,
                "content": item.rule.content,
                "position": item.rule.position,
                "depth": item.rule.depth,
                "order": item.rule.order,
            }
            for item in self.entries
        ]
```

- [x] **Step 4: Implement keyword parsing and matching**

```python
# server/services/lorebook_matcher.py
import re

from .lorebook_types import LorebookRule, MatchResult


def split_keys(value: str | None) -> tuple[str, ...]:
    return tuple(part.strip() for part in (value or "").split(",") if part.strip())


def _match_key(rule: LorebookRule, key: str, text: str) -> tuple[bool, str | None]:
    flags = 0 if rule.case_sensitive else re.IGNORECASE
    if key.startswith("/") and key.endswith("/") and len(key) > 2:
        try:
            return re.search(key[1:-1], text, flags) is not None, None
        except re.error:
            return False, "invalid_regular_expression"
    pattern = re.escape(key)
    if rule.match_whole_words:
        pattern = rf"(?<!\w){pattern}(?!\w)"
    return re.search(pattern, text, flags) is not None, None


def match_rule(rule: LorebookRule, text: str) -> MatchResult:
    if rule.constant:
        return MatchResult(True, "constant")
    primary_matches = []
    secondary_matches = []
    for target, keys in (
        (primary_matches, rule.primary_keys),
        (secondary_matches, rule.secondary_keys),
    ):
        for key in keys:
            matched, error = _match_key(rule, key, text)
            if error:
                return MatchResult(False, "invalid_rule", error=error)
            if matched:
                target.append(key)
    primary = bool(primary_matches)
    secondary = bool(secondary_matches)
    if not rule.secondary_keys:
        matched = primary
    elif rule.selective_logic == "and":
        matched = primary and secondary
    else:
        matched = primary or secondary
    reason = "matched" if matched else (
        "secondary_not_matched" if primary and not secondary else "keyword_not_matched"
    )
    return MatchResult(matched, reason, tuple(primary_matches + secondary_matches))
```

- [x] **Step 5: Run matcher tests**

Run: `python -m pytest -q tests/test_lorebook_matcher.py`

Expected: all matcher tests PASS.

- [x] **Step 6: Commit the pure matcher**

```powershell
git add -- "守岸人3.0/server/services/lorebook_types.py" "守岸人3.0/server/services/lorebook_matcher.py" "守岸人3.0/tests/test_lorebook_matcher.py"
git commit -m "feat(shouanren): add lorebook rule matcher"
```

### Task 2: Base Evaluation, Probability, Delay, and Trace

**Files:**
- Create: `守岸人3.0/server/services/lorebook_engine.py`
- Create: `守岸人3.0/tests/test_lorebook_engine.py`

- [x] **Step 1: Write failing evaluation tests**

```python
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
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `python -m pytest -q tests/test_lorebook_engine.py::test_scan_depth_constant_probability_delay_and_trace`

Expected: FAIL because `LorebookEngine` does not exist.

- [x] **Step 3: Implement the base evaluator**

```python
# server/services/lorebook_engine.py
from collections.abc import Callable

from .lorebook_matcher import match_rule
from .lorebook_types import (
    EvaluatedEntry,
    LorebookEvaluation,
    LorebookRule,
    TraceRecord,
)


def estimate_tokens(text: str) -> int:
    cjk = sum("\u3400" <= char <= "\u9fff" for char in text)
    non_cjk = max(0, len(text) - cjk)
    return max(1, cjk + (non_cjk + 3) // 4)


class LorebookEngine:
    def __init__(self, *, random_value: Callable[[], float]):
        self.random_value = random_value

    def evaluate(
        self,
        *,
        rules: list[LorebookRule],
        history: list[dict[str, str]],
        current_input: str,
        scan_depth: int,
        current_sequence: int,
        token_budget: int,
        prior_activations=(),
        recursive_scan: bool = True,
        max_recursion_steps: int = 3,
    ) -> LorebookEvaluation:
        scanned = history[-scan_depth:] if scan_depth > 0 else []
        scan_text = "\n".join([item["content"] for item in scanned] + [current_input])
        result = LorebookEvaluation()
        candidates = []
        for rule in rules:
            if rule.recursion_only:
                result.trace.append(TraceRecord(rule.id, "skipped", "recursion_only"))
                continue
            if current_sequence < rule.delay:
                result.trace.append(TraceRecord(rule.id, "skipped", "delay_not_reached"))
                continue
            matched = match_rule(rule, scan_text)
            if matched.error:
                result.trace.append(TraceRecord(rule.id, "error", matched.error))
                continue
            if not matched.matched:
                result.trace.append(TraceRecord(rule.id, "skipped", matched.reason))
                continue
            if rule.probability < 1.0 and self.random_value() >= rule.probability:
                result.trace.append(TraceRecord(rule.id, "skipped", "probability_rejected"))
                continue
            candidates.append((rule, matched.reason, 0))
        return self._finalize(candidates, result, token_budget)

    def _finalize(self, candidates, result, token_budget):
        ordered = sorted(candidates, key=lambda item: (-item[0].priority, item[0].order, item[0].id))
        for rule, reason, level in ordered:
            cost = estimate_tokens(rule.content)
            if result.used_tokens + cost > token_budget:
                result.trace.append(TraceRecord(rule.id, "skipped", "token_budget_exceeded", level, cost))
                continue
            result.entries.append(EvaluatedEntry(rule, reason, cost))
            result.used_tokens += cost
            result.trace.append(TraceRecord(rule.id, "activated", reason, level, cost))
        return result
```

- [x] **Step 4: Run base evaluator tests**

Run: `python -m pytest -q tests/test_lorebook_engine.py`

Expected: base evaluation tests PASS.

- [x] **Step 5: Commit the base evaluator**

```powershell
git add -- "守岸人3.0/server/services/lorebook_engine.py" "守岸人3.0/tests/test_lorebook_engine.py"
git commit -m "feat(shouanren): evaluate lorebook rules"
```

### Task 3: Recursion, Inclusion Groups, Timed Effects, and Budget

**Files:**
- Modify: `守岸人3.0/server/services/lorebook_engine.py`
- Modify: `守岸人3.0/tests/test_lorebook_engine.py`

- [x] **Step 1: Add failing advanced-engine tests**

```python
def test_recursion_group_budget_and_timed_effects():
    rules = [
        LorebookRule("seed", "Rufus is nearby", ("Bessie",), priority=10),
        LorebookRule("recursive", "Rufus is a dog", ("Rufus",), priority=9),
        LorebookRule("group-a", "A", ("choice",), group="scene", group_weight=10),
        LorebookRule("group-b", "B", ("choice",), group="scene", group_weight=90),
        LorebookRule("sticky", "stays", ("gone",), sticky=3, cooldown=2, revision=2),
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
    item = LorebookRule("entry", "content", ("absent",), sticky=1, cooldown=2, revision=3)
    stale = ActivationRecord("entry", 2, 4, 1, 2)
    current = ActivationRecord("entry", 3, 4, 1, 2)
    engine = LorebookEngine(random_value=lambda: 0.0)
    stale_result = engine.evaluate(
        rules=[item], history=[], current_input="none", scan_depth=1,
        current_sequence=5, token_budget=100, prior_activations=[stale],
    )
    current_result = engine.evaluate(
        rules=[item], history=[], current_input="none", scan_depth=1,
        current_sequence=6, token_budget=100, prior_activations=[current],
    )
    assert stale_result.activated_ids == []
    assert {trace.reason for trace in current_result.trace} == {"cooldown_active"}
```

- [x] **Step 2: Run advanced tests and verify RED**

Run: `python -m pytest -q tests/test_lorebook_engine.py -k "recursion or cooldown"`

Expected: FAIL because recursion, groups, and timed effects are not implemented.

- [x] **Step 3: Extend evaluation in a fixed order**

Implement these pure functions in `lorebook_engine.py` and call them in this order:

```python
def timed_status(rule, records, current_sequence):
    matching = [
        record for record in records
        if record.entry_id == rule.id and record.entry_revision == rule.revision
    ]
    if not matching:
        return None
    latest = max(matching, key=lambda record: record.trigger_sequence)
    sticky_end = latest.trigger_sequence + latest.sticky
    cooldown_end = sticky_end + latest.cooldown
    if current_sequence <= sticky_end:
        return "sticky_active"
    if current_sequence <= cooldown_end:
        return "cooldown_active"
    return None


def choose_group(items, random_value):
    if any(item[0].group_prioritized for item in items):
        return sorted(items, key=lambda item: (-item[0].priority, item[0].order, item[0].id))[0]
    total = sum(max(0, item[0].group_weight) for item in items)
    if total <= 0:
        return sorted(items, key=lambda item: item[0].id)[0]
    target = random_value() * total
    cursor = 0
    for item in sorted(items, key=lambda candidate: candidate[0].id):
        cursor += max(0, item[0].group_weight)
        if target < cursor:
            return item
    return sorted(items, key=lambda item: item[0].id)[-1]
```

Evaluation order must be: revision-aware timed state, delay, initial match, probability, recursive expansion, group reduction, stable sort, Token budget. Sticky entries bypass keyword and probability checks. Cooldown entries cannot activate. Recursive expansion appends activated content to the scan buffer, never activates the same entry twice, skips `exclude_recursion`, and does not append content from `prevent_recursion` entries. `recursion_only` entries are eligible only after recursion level zero.

- [x] **Step 4: Run all engine tests**

Run: `python -m pytest -q tests/test_lorebook_engine.py`

Expected: all engine tests PASS, including stable trace order and budget rejection reasons.

- [x] **Step 5: Commit advanced evaluation**

```powershell
git add -- "守岸人3.0/server/services/lorebook_engine.py" "守岸人3.0/tests/test_lorebook_engine.py"
git commit -m "feat(shouanren): add advanced lorebook evaluation"
```

### Task 4: Schema Version 3, Scope Bindings, and Activation Events

**Files:**
- Modify: `守岸人3.0/server/models/lorebook.py`
- Modify: `守岸人3.0/server/migrations.py`
- Modify: `守岸人3.0/server/database.py`
- Modify: `守岸人3.0/server/tests/test_database_migrations.py`
- Modify: `守岸人3.0/tests/test_resource_security.py`

- [x] **Step 1: Add failing model and migration tests**

```python
def test_lorebook_advanced_fields_and_activation_event(db_session, resource_graph):
    from server.models.lorebook import LorebookActivationEvent, LorebookBinding
    book = resource_graph.lorebook
    entry = resource_graph.entry
    book.token_budget = 900
    book.recursive_scan = True
    book.max_recursion_steps = 4
    entry.sticky = 3
    entry.delay = 2
    entry.revision = 5
    event = LorebookActivationEvent(
        session_id="resource-story-session",
        entry_id=entry.id,
        response_message_id="response-1",
        entry_revision=5,
        trigger_sequence=8,
        sticky=3,
        cooldown=2,
    )
    chat_binding = LorebookBinding(
        lorebook_id=book.id,
        scope_type="chat",
        scope_id=resource_graph.chat_session.id,
    )
    persona_binding = LorebookBinding(
        lorebook_id=book.id,
        scope_type="persona",
        scope_id="reserved-persona-id",
    )
    db_session.add_all([event, chat_binding, persona_binding])
    db_session.commit()
    assert book.to_dict()["token_budget"] == 900
    assert entry.to_dict()["sticky"] == 3
    assert event.entry_revision == 5
    assert chat_binding.scope_type == "chat"
    assert persona_binding.scope_type == "persona"
```

Change the migration assertion to `assert version == 3` and add an inspector assertion for every new column and the `lorebook_activation_events` table.

- [x] **Step 2: Run migration/model tests and verify RED**

Run: `python -m pytest -q server/tests/test_database_migrations.py tests/test_resource_security.py -k "migration or advanced_fields"`

Expected: FAIL because schema version 3 fields and the event model do not exist.

- [x] **Step 3: Add model fields and serialization**

Add to `Lorebook`:

```python
token_budget = Column(Integer, default=1024, nullable=False)
recursive_scan = Column(Boolean, default=True, nullable=False)
max_recursion_steps = Column(Integer, default=3, nullable=False)
```

Add to `LorebookEntry`:

```python
sticky = Column(Integer, default=0, nullable=False)
delay = Column(Integer, default=0, nullable=False)
prevent_recursion = Column(Boolean, default=False, nullable=False)
recursion_only = Column(Boolean, default=False, nullable=False)
group_prioritized = Column(Boolean, default=False, nullable=False)
revision = Column(Integer, default=1, nullable=False)
```

Create in the same model file:

```python
class LorebookBinding(Base):
    __tablename__ = "lorebook_bindings"
    __table_args__ = (
        UniqueConstraint(
            "lorebook_id", "scope_type", "scope_id",
            name="uq_lorebook_binding_scope",
        ),
        CheckConstraint(
            "scope_type IN ('character', 'chat', 'persona')",
            name="ck_lorebook_binding_scope_type",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    lorebook_id = Column(String, nullable=False, index=True)
    scope_type = Column(String(20), nullable=False, index=True)
    scope_id = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LorebookActivationEvent(Base):
    __tablename__ = "lorebook_activation_events"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "response_message_id", "entry_id",
            name="uq_lorebook_activation_response_entry",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, nullable=False, index=True)
    entry_id = Column(String, nullable=False, index=True)
    response_message_id = Column(String, nullable=False, index=True)
    entry_revision = Column(Integer, nullable=False)
    trigger_sequence = Column(Integer, nullable=False)
    sticky = Column(Integer, nullable=False, default=0)
    cooldown = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

Import `CheckConstraint` and `UniqueConstraint`, include all new fields in `to_dict`, and increment `entry.revision` in the update-entry route whenever any prompt-affecting field changes. Keep the existing `Lorebook.character_id` as the owning/default character binding for backward compatibility. `LorebookBinding` adds opt-in chat and future Persona scopes without requiring the Persona table to exist in phase 1; the API must reject a `persona` binding until phase 2 can verify ownership of a real Persona.

- [x] **Step 4: Add additive migration version 3**

Set `CURRENT_SCHEMA_VERSION = 3`. In `_migrate_existing_tables`, use `_ensure_column` for all new book and entry fields, then call:

```python
from .models.lorebook import LorebookActivationEvent, LorebookBinding

LorebookBinding.__table__.create(bind=engine, checkfirst=True)
LorebookActivationEvent.__table__.create(bind=engine, checkfirst=True)
```

Do not add foreign keys to legacy tables in this migration; runtime ownership and cleanup are enforced in the service so SQLite and PostgreSQL upgrades behave consistently.

- [x] **Step 5: Run model and migration tests**

Run: `python -m pytest -q server/tests/test_database_migrations.py tests/test_resource_security.py`

Expected: all selected tests PASS and a version-2 database upgrades to version 3 once, with both `lorebook_bindings` and `lorebook_activation_events` present.

- [x] **Step 6: Commit schema version 3**

```powershell
git add -- "守岸人3.0/server/models/lorebook.py" "守岸人3.0/server/migrations.py" "守岸人3.0/server/database.py" "守岸人3.0/server/tests/test_database_migrations.py" "守岸人3.0/tests/test_resource_security.py"
git commit -m "feat(shouanren): persist lorebook runtime settings"
```

### Task 5: SQLAlchemy Runtime Adapter and Branch Inheritance

**Files:**
- Create: `守岸人3.0/server/services/lorebook_runtime.py`
- Create: `守岸人3.0/tests/test_lorebook_runtime.py`

- [x] **Step 1: Write failing runtime tests**

```python
def test_runtime_uses_only_events_on_active_path(db_session, seeded_chat):
    runtime = LorebookRuntime(db_session, owner_id=seeded_chat.owner.id, random_value=lambda: 0.0)
    inherited = runtime.activation_records(
        seeded_chat.session.id,
        active_message_ids={seeded_chat.assistant_message.id},
    )
    discarded = runtime.activation_records(
        seeded_chat.session.id,
        active_message_ids={seeded_chat.user_message.id},
    )
    assert [item.entry_id for item in inherited] == ["sticky-entry"]
    assert discarded == []


def test_record_evaluation_is_idempotent(db_session, seeded_chat):
    runtime = LorebookRuntime(db_session, owner_id=seeded_chat.owner.id, random_value=lambda: 0.0)
    runtime.record_evaluation(seeded_chat.session.id, seeded_chat.assistant_message, evaluation)
    runtime.record_evaluation(seeded_chat.session.id, seeded_chat.assistant_message, evaluation)
    count = db_session.query(LorebookActivationEvent).count()
    expected = sum(
        1 for item in evaluation.entries
        if (item.rule.sticky > 0 or item.rule.cooldown > 0)
        and item.activation_reason != "sticky_active"
    )
    assert count == expected


def test_sticky_carry_forward_does_not_renew_trigger_sequence(db_session, seeded_chat):
    runtime = LorebookRuntime(db_session, owner_id=seeded_chat.owner.id, random_value=lambda: 0.0)
    runtime.record_evaluation(seeded_chat.session.id, seeded_chat.assistant_message, sticky_evaluation)
    assert db_session.query(LorebookActivationEvent).count() == 0


def test_runtime_combines_character_default_and_chat_bound_books(db_session, seeded_chat):
    runtime = LorebookRuntime(db_session, owner_id=seeded_chat.owner.id, random_value=lambda: 0.0)
    rule_ids = {
        rule.id
        for rule in runtime.rules_for_context(
            character_id=seeded_chat.character.id,
            session_id=seeded_chat.session.id,
        )
    }
    assert rule_ids == {"character-default-entry", "chat-bound-entry"}


def test_chat_binding_does_not_leak_to_another_session(db_session, seeded_chat):
    runtime = LorebookRuntime(db_session, owner_id=seeded_chat.owner.id, random_value=lambda: 0.0)
    rule_ids = {
        rule.id
        for rule in runtime.rules_for_context(
            character_id=seeded_chat.character.id,
            session_id=seeded_chat.other_session.id,
        )
    }
    assert "chat-bound-entry" not in rule_ids
```

Seed a character lorebook, a second book bound to exactly one chat, a sticky entry, and one activation event in the fixture before assertions.

- [x] **Step 2: Run runtime tests and verify RED**

Run: `python -m pytest -q tests/test_lorebook_runtime.py`

Expected: FAIL because `LorebookRuntime` does not exist.

- [x] **Step 3: Implement row mapping, evaluation, and persistence**

```python
class LorebookRuntime:
    def __init__(self, db, *, owner_id, random_value):
        self.db = db
        self.owner_id = owner_id
        self.engine = LorebookEngine(random_value=random_value)

    def activation_records(self, session_id, *, active_message_ids):
        rows = self.db.scalars(
            select(LorebookActivationEvent).where(
                LorebookActivationEvent.session_id == session_id,
                LorebookActivationEvent.response_message_id.in_(active_message_ids),
            )
        )
        return [
            ActivationRecord(
                row.entry_id, row.entry_revision, row.trigger_sequence,
                row.sticky, row.cooldown,
            )
            for row in rows
        ]
```

Add `rules_for_context`, `_to_rule`, `evaluate`, `record_evaluation`, and `delete_events_for_session`. `rules_for_context` loads enabled books whose legacy `character_id` matches the session character plus books explicitly bound to that chat, then de-duplicates books and entries by ID. It must not load chat bindings for another session or unvalidated Persona bindings. `evaluate` calls `ChatHistoryService.owned_session`, derives active-path IDs and history from `selected_text`, loads the context rules, and combines book settings conservatively: the smallest positive Token budget, largest scan depth, recursion enabled when any active book enables it, and largest maximum recursion step count. For a new chat request, define `current_sequence` as the active-path user-message count plus one for the unsaved current input; for regeneration, use the existing active-path user-message count. Assistant Swipes never advance it. `record_evaluation` uses the assistant response message ID, persists only newly matched entries whose `sticky` or `cooldown` is positive, never persists an entry carried by `sticky_active`, and checks uniqueness before insert rather than swallowing database errors. This prevents sticky state from renewing itself forever and preserves the existing behavior that failed LLM calls do not save a half-finished user turn.

- [x] **Step 4: Run runtime and chat-history tests**

Run: `python -m pytest -q tests/test_lorebook_runtime.py tests/test_chat_history.py`

Expected: all tests PASS, including branch paths that retain and discard activation events.

- [x] **Step 5: Commit the runtime adapter**

```powershell
git add -- "守岸人3.0/server/services/lorebook_runtime.py" "守岸人3.0/tests/test_lorebook_runtime.py"
git commit -m "feat(shouanren): add branch-aware lorebook runtime"
```

### Task 6: Advanced Lorebook API and Dry-run Debugger

**Files:**
- Modify: `守岸人3.0/server/routers/lorebook.py`
- Create: `守岸人3.0/tests/test_lorebook_api.py`

- [x] **Step 1: Write failing API tests**

```python
def test_owner_can_update_advanced_settings(lorebook_api, resource_graph):
    response = lorebook_api.client.put(
        f"/api/lorebooks/{resource_graph.lorebook.id}",
        json={"token_budget": 800, "recursive_scan": True, "max_recursion_steps": 5},
    )
    assert response.status_code == 200
    assert response.json()["token_budget"] == 800


def test_debug_trace_is_owned_and_does_not_persist_events(lorebook_api, resource_graph, db_session):
    response = lorebook_api.client.post(
        "/api/lorebooks/debug",
        json={"session_id": resource_graph.chat_session.id, "text": "shore"},
    )
    assert response.status_code == 200
    assert response.json()["activated_ids"] == [resource_graph.entry.id]
    assert db_session.query(LorebookActivationEvent).count() == 0


def test_advanced_values_are_bounded(lorebook_api, resource_graph):
    response = lorebook_api.client.post(
        f"/api/lorebooks/{resource_graph.lorebook.id}/entries",
        json={"keyword": "x", "content": "y", "sticky": -1},
    )
    assert response.status_code == 422


def test_owner_can_replace_chat_bindings(lorebook_api, resource_graph):
    response = lorebook_api.client.put(
        f"/api/lorebooks/{resource_graph.lorebook.id}/bindings",
        json={"chat_session_ids": [resource_graph.chat_session.id]},
    )
    assert response.status_code == 200
    assert response.json()["chat_session_ids"] == [resource_graph.chat_session.id]


def test_binding_rejects_foreign_or_wrong_character_chat(lorebook_api, resource_graph):
    response = lorebook_api.client.put(
        f"/api/lorebooks/{resource_graph.lorebook.id}/bindings",
        json={"chat_session_ids": [resource_graph.foreign_chat_session.id]},
    )
    assert response.status_code == 404
```

Extend `resource_graph` with a `ChatSession` owned by the fixture owner.

- [x] **Step 2: Run API tests and verify RED**

Run: `python -m pytest -q tests/test_lorebook_api.py`

Expected: FAIL because advanced payload fields and `/api/lorebooks/debug` are absent.

- [x] **Step 3: Extend request models and update logic**

Use bounded fields:

```python
token_budget: Optional[int] = Field(default=None, ge=64, le=65536)
max_recursion_steps: Optional[int] = Field(default=None, ge=1, le=20)
sticky: Optional[int] = Field(default=None, ge=0, le=10000)
delay: Optional[int] = Field(default=None, ge=0, le=10000)
revision: int = Field(default=1, ge=1)
```

Add `prevent_recursion`, `recursion_only`, and `group_prioritized` booleans. Maintain a tuple of prompt-affecting entry fields; if any supplied value differs from the stored value, increment `entry.revision` exactly once before commit.

Add `GET /{lorebook_id}/bindings` and `PUT /{lorebook_id}/bindings`. The replacement payload is:

```python
class LorebookBindingsUpdate(BaseModel):
    chat_session_ids: list[str] = Field(default_factory=list, max_length=100)
```

The PUT route requires editable access to the lorebook, removes only its existing `chat` bindings, validates every requested `ChatSession` belongs to the current user and has the same `character_id` as the lorebook, rejects duplicates before writing, and returns the sorted bound IDs. Do not expose arbitrary `scope_type` or `scope_id` writes. Persona scope remains reserved in the schema and becomes writable only after phase 2 adds an owned Persona resource.

- [x] **Step 4: Add the owned dry-run endpoint**

```python
class LorebookDebugRequest(BaseModel):
    session_id: str
    text: str = Field(min_length=1, max_length=20000)


@router.post("/debug")
async def debug_lorebook(
    req: LorebookDebugRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    runtime = LorebookRuntime(db, owner_id=current_user.id, random_value=random.random)
    evaluation = runtime.evaluate(req.session_id, current_input=req.text)
    return {
        "activated_ids": evaluation.activated_ids,
        "used_tokens": evaluation.used_tokens,
        "entries": evaluation.prompt_entries(),
        "trace": [asdict(item) for item in evaluation.trace],
    }
```

Route order must place `/debug` before `/{lorebook_id}` routes so FastAPI does not interpret `debug` as an ID. The runtime ownership check returns 404 for another user's session.

- [x] **Step 5: Run lorebook API and resource-security tests**

Run: `python -m pytest -q tests/test_lorebook_api.py tests/test_resource_security.py`

Expected: all selected tests PASS, including chat-binding ownership and cross-character isolation.

- [x] **Step 6: Commit the advanced API**

```powershell
git add -- "守岸人3.0/server/routers/lorebook.py" "守岸人3.0/tests/test_lorebook_api.py" "守岸人3.0/tests/test_resource_security.py"
git commit -m "feat(shouanren): expose advanced lorebook controls"
```

### Task 7: Prompt Injection and Chat Integration

**Files:**
- Modify: `守岸人3.0/server/routers/chat.py`
- Modify: `守岸人3.0/server/utils/prompt_builder.py`
- Modify: `守岸人3.0/tests/test_chat_api.py`
- Modify: `守岸人3.0/tests/test_lorebook_api.py`

- [x] **Step 1: Write failing prompt and chat tests**

```python
def test_chat_injects_before_after_and_depth_entries(chat_client, fake_llm, seeded_lorebooks):
    response = chat_client.post(
        "/api/chat",
        data={"session_id": "session-1", "text": "shore"},
    )
    assert response.status_code == 200
    sent = fake_llm.last_messages
    assert sent[0]["content"].index("before knowledge") < sent[0]["content"].index("character sentinel")
    assert sent[0]["content"].index("after knowledge") > sent[0]["content"].index("character sentinel")
    assert any(item["content"] == "depth knowledge" for item in sent[1:])


def test_chat_persists_activation_against_assistant_response(chat_client, db_session):
    response = chat_client.post("/api/chat", data={"session_id": "session-1", "text": "shore"})
    response_message_id = response.json()["message_id"]
    event = db_session.query(LorebookActivationEvent).one()
    assert event.response_message_id == response_message_id


def test_regeneration_uses_lorebook_without_advancing_timed_state(chat_client, db_session, seeded_lorebooks):
    before = db_session.query(LorebookActivationEvent).count()
    response = chat_client.post(
        "/api/chat/messages/message-2/regenerate",
        data={"version": 1},
    )
    assert response.status_code == 200
    assert db_session.query(LorebookActivationEvent).count() == before
```

Seed the character prompt with the literal `character sentinel`, and make the timed entry in the persistence test use a positive `sticky` or `cooldown` so an activation event is expected.

- [x] **Step 2: Run chat integration tests and verify RED**

Run: `python -m pytest -q tests/test_chat_api.py tests/test_lorebook_api.py -k lorebook`

Expected: FAIL because chat still uses its inline matcher and does not persist activation events.

- [x] **Step 3: Make prompt positions explicit**

Keep `build_system_prompt` responsible for `before_char` and `after_char`. Pass depth entries to `build_messages`:

```python
prompt_entries = evaluation.prompt_entries()
system_prompt = build_system_prompt(
    character,
    world_info_entries=prompt_entries,
    memories=memory_list,
    summary=summary,
)
depth_segments = [
    {"depth": item["depth"], "content": item["content"], "role": "system"}
    for item in prompt_entries
    if item["position"] == "depth"
]
messages = build_messages(system_prompt, history, depth_segments=depth_segments)
```

Add prompt-builder tests proving multiple entries at the same depth retain stable `order`, and a depth larger than available history is injected immediately after the system message rather than silently discarded.

- [x] **Step 4: Replace the inline matcher with `LorebookRuntime`**

Remove the `MAX_LOREBOOK_ENTRIES`, regex loop, and fixed list slicing from `chat.py`. Evaluate before calling the LLM. After appending the assistant message, call:

```python
runtime.record_evaluation(session.id, ai_msg, evaluation)
```

For regeneration, build context from `prompt_messages_before(message_id)`, use the last user message as `current_input`, evaluate without persisting new events, and then append the new Swipe. This preserves timed state because a Swipe does not advance the active path.

- [x] **Step 5: Run chat, prompt, branch, and backup tests**

Run: `python -m pytest -q tests/test_chat_api.py tests/test_chat_history.py tests/test_chat_backups.py tests/test_lorebook_api.py`

Expected: all selected tests PASS and existing edit/delete/Swipe/checkpoint behavior remains unchanged.

- [x] **Step 6: Commit chat integration**

```powershell
git add -- "守岸人3.0/server/routers/chat.py" "守岸人3.0/server/utils/prompt_builder.py" "守岸人3.0/tests/test_chat_api.py" "守岸人3.0/tests/test_lorebook_api.py"
git commit -m "feat(shouanren): integrate lorebooks into chat prompts"
```

### Task 8: Worldbook Management and Debug UI

**Files:**
- Create: `守岸人3.0/frontend/lorebooks.html`
- Create: `守岸人3.0/frontend/js/lorebooks.js`
- Modify: `守岸人3.0/frontend/characters.html`
- Create: `守岸人3.0/tests/test_lorebook_frontend_contract.py`

- [x] **Step 1: Write failing frontend contract tests**

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_lorebook_page_exposes_advanced_controls_and_debugger():
    page = (ROOT / "frontend" / "lorebooks.html").read_text("utf-8")
    script = (ROOT / "frontend" / "js" / "lorebooks.js").read_text("utf-8")
    for control in (
        "token-budget", "scan-depth", "recursive-scan", "sticky", "cooldown",
        "delay", "group-weight", "entry-position", "chat-bindings", "debug-input",
        "debug-trace",
    ):
        assert f'id="{control}"' in page
    assert "/api/lorebooks/debug" in script
    assert "textContent" in script


def test_character_page_links_owned_character_to_lorebook_manager():
    page = (ROOT / "frontend" / "characters.html").read_text("utf-8")
    assert "lorebooks.html?character_id=" in page
```

- [x] **Step 2: Run the contract tests and verify RED**

Run: `python -m pytest -q tests/test_lorebook_frontend_contract.py`

Expected: FAIL because the management page and script do not exist.

- [x] **Step 3: Build the authenticated management page**

The page must load `css/main.css`, `js/auth.js`, `js/api.js`, and `js/lorebooks.js`; call `Auth.loadUser()` before private API requests; read only `character_id` from `URLSearchParams`; and render these sections:

```html
<main class="page-container">
  <section id="book-settings" aria-labelledby="book-settings-title"></section>
  <section id="chat-bindings" aria-labelledby="chat-bindings-title"></section>
  <section id="entry-list" aria-labelledby="entry-list-title"></section>
  <dialog id="entry-editor" aria-labelledby="entry-editor-title"></dialog>
  <section id="debugger" aria-labelledby="debugger-title">
    <textarea id="debug-input" maxlength="20000"></textarea>
    <div id="debug-trace" aria-live="polite"></div>
  </section>
</main>
```

Use labels for every input, keyboard-accessible buttons, confirmation before destructive actions, disabled submit buttons while requests run, and inline error messages. Render all server strings with `textContent`, never `innerHTML`.

- [x] **Step 4: Implement API orchestration in `lorebooks.js`**

Keep one explicit state object and implement the orchestration functions with the existing `API` client:

```javascript
const state = {
  characterId: null,
  books: [],
  selectedBookId: null,
  entries: [],
  chatSessionIds: [],
};

async function loadBooks(characterId) {
  state.characterId = characterId;
  state.books = await API.get(`/api/lorebooks/character/${encodeURIComponent(characterId)}`);
  if (state.books.length > 0) await selectBook(state.books[0].id);
  return state.books;
}

async function selectBook(bookId) {
  state.selectedBookId = bookId;
  const [entries, bindings] = await Promise.all([
    loadEntries(bookId),
    API.get(`/api/lorebooks/${encodeURIComponent(bookId)}/bindings`),
  ]);
  state.chatSessionIds = bindings.chat_session_ids;
  renderEntries(entries);
  renderBindings(state.chatSessionIds);
}

async function saveBook(payload) {
  const bookId = encodeURIComponent(state.selectedBookId);
  const saved = await API.put(`/api/lorebooks/${bookId}`, payload);
  state.books = state.books.map((item) => item.id === saved.id ? saved : item);
  return saved;
}

async function saveBindings(chatSessionIds) {
  const bookId = encodeURIComponent(state.selectedBookId);
  const result = await API.put(`/api/lorebooks/${bookId}/bindings`, { chat_session_ids: chatSessionIds });
  state.chatSessionIds = result.chat_session_ids;
  renderBindings(state.chatSessionIds);
  return result;
}

async function loadEntries(bookId) {
  state.entries = await API.get(`/api/lorebooks/${encodeURIComponent(bookId)}/entries`);
  return state.entries;
}

async function saveEntry(entryId, payload) {
  const endpoint = entryId
    ? `/api/lorebooks/entries/${encodeURIComponent(entryId)}`
    : `/api/lorebooks/${encodeURIComponent(state.selectedBookId)}/entries`;
  const saved = entryId ? await API.put(endpoint, payload) : await API.post(endpoint, payload);
  await loadEntries(state.selectedBookId);
  renderEntries(state.entries);
  return saved;
}

async function deleteEntry(entryId) {
  if (!window.confirm('确认删除这个世界书条目？')) return false;
  await API.del(`/api/lorebooks/entries/${encodeURIComponent(entryId)}`);
  await loadEntries(state.selectedBookId);
  renderEntries(state.entries);
  return true;
}

async function runDebug(sessionId, text) {
  const result = await API.post('/api/lorebooks/debug', { session_id: sessionId, text });
  renderTrace(result.trace);
  return result;
}

function replaceChildrenWithTextRows(containerId, rows, format) {
  const container = document.getElementById(containerId);
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const element = document.createElement('div');
    element.textContent = format(row);
    fragment.appendChild(element);
  });
  container.replaceChildren(fragment);
}

function renderEntries(entries) {
  replaceChildrenWithTextRows('entry-list-body', entries, (entry) =>
    `${entry.comment || entry.keyword || '常驻条目'} · ${entry.position} · 优先级 ${entry.priority}`,
  );
}

function renderBindings(sessionIds) {
  replaceChildrenWithTextRows('chat-bindings-list', sessionIds, (sessionId) => sessionId);
}

function renderTrace(trace) {
  replaceChildrenWithTextRows('debug-trace', trace, (item) =>
    `${item.status} · ${item.reason} · 递归 ${item.recursion_level} · ${item.estimated_tokens} Token`,
  );
}
```

Populate the available chat-binding selector from `/api/chat/characters`, filtered to the selected character. `loadEntries` preserves server ordering. The editor submit handler serializes numeric controls with `Number`, booleans with `.checked`, and blank optional strings as `null` before calling `saveEntry`. `runDebug` renders status, reason, recursion level, and estimated Token count for every trace row.

- [x] **Step 5: Add the character-page action and run syntax checks**

Show the action only when the current user can edit the character. Link with `encodeURIComponent(character.id)`.

Run:

```powershell
python -m pytest -q tests/test_lorebook_frontend_contract.py tests/test_site_auth.py
node --check "frontend/js/lorebooks.js"
```

Expected: tests PASS and Node exits 0.

- [x] **Step 6: Commit the management UI**

```powershell
git add -- "守岸人3.0/frontend/lorebooks.html" "守岸人3.0/frontend/js/lorebooks.js" "守岸人3.0/frontend/characters.html" "守岸人3.0/tests/test_lorebook_frontend_contract.py"
git commit -m "feat(shouanren): add worldbook management UI"
```

### Task 9: Documentation, Full Verification, and Runtime Migration

**Files:**
- Modify: `守岸人3.0/README.md`
- Modify: `docs/superpowers/plans/2026-08-10-shouanren-lorebook-engine.md`

- [x] **Step 1: Update the README to match implemented behavior**

Document the trigger pipeline, timed-effect message semantics, recursion limit, Token budget, dry-run debugger, branch inheritance, schema version 3, and the clean-room rule. State explicitly that group chat and interactive story integration belong to later stages and are not silently enabled by this phase.

- [x] **Step 2: Run the complete ShouAnRen suite**

Run: `python -m pytest -q`

Working directory: `守岸人3.0`

Expected: zero failures.

- [x] **Step 3: Run Python and frontend syntax checks**

Run: `python -m compileall -q server tests`

Extract each inline `<script>` from `frontend/*.html` and run `node --check -`; run `node --check` for every `frontend/js/*.js` file.

Expected: zero syntax failures.

- [x] **Step 4: Inspect scope and whitespace**

Run:

```powershell
git diff --check
git status --short
git diff --stat -- "守岸人3.0" "docs/superpowers/plans/2026-08-10-shouanren-lorebook-engine.md"
```

Expected: no whitespace errors. Stage only files listed in this plan; leave OpenWrite, stock, reports, SD, site-auth, and unrelated ShouAnRen frontend changes untouched.

- [x] **Step 5: Restart the complete local stack**

Run from `E:\AI\gp`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-local.ps1
```

Allow at least 300 seconds for sequential service startup. Expected: all ports 8000–8009 and 5173–5175 pass, unified login succeeds, anonymous private endpoints return 401, and authenticated ShouAnRen chat returns 200.

- [x] **Step 6: Verify the real database migration**

Run in `守岸人3.0`:

```powershell
@'
from sqlalchemy import inspect, text
from server.database import engine
with engine.connect() as connection:
    version = connection.execute(text("SELECT version FROM schema_metadata WHERE id = 1")).scalar_one()
tables = set(inspect(engine).get_table_names())
print({"schema_version": version, "activation_events": "lorebook_activation_events" in tables})
'@ | python -
```

Expected: `{'schema_version': 3, 'activation_events': True}`.

- [x] **Step 7: Mark completed checkboxes and commit the phase**

Update this plan's executed steps from `[ ]` to `[x]`, then stage only the documented phase files and commit:

```powershell
git add -- "docs/superpowers/plans/2026-08-10-shouanren-lorebook-engine.md" "守岸人3.0/README.md"
git commit -m "docs(shouanren): document advanced lorebooks"
```

Do not delete `SillyTavern/` or any other reference project in this phase.
