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

    def prompt_entries(self) -> list[dict[str, str | int]]:
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
