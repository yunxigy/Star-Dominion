"""Shared staircase-and-ratio context budget planning."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import inf
from typing import Any


@dataclass(frozen=True)
class _TierSpec:
    upper_usage_ratio: float
    level: int
    target_ratio: float
    memory_ratio: float
    recent_ratio: float


_TIER_SPECS = (
    _TierSpec(0.70, 0, 1.00, 0.24, 0.28),
    _TierSpec(0.85, 1, 0.70, 0.16, 0.26),
    _TierSpec(1.00, 2, 0.80, 0.10, 0.22),
    _TierSpec(1.20, 3, 0.88, 0.07, 0.18),
    _TierSpec(inf, 4, 0.90, 0.04, 0.12),
)


@dataclass(frozen=True)
class ContextBudgetPlan:
    """One context decision, expressed in provider and compression budgets."""

    context_window_tokens: int
    reserved_output_tokens: int
    safety_tokens: int
    input_budget_tokens: int
    used_tokens: int
    usage_ratio: float
    level: int
    target_ratio: float
    target_tokens: int
    memory_ratio: float
    recent_ratio: float

    @property
    def requires_compression(self) -> bool:
        return self.level > 0

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["usage_ratio"] = round(self.usage_ratio, 4)
        return payload


class ContextBudgetPolicy:
    """Reserve output first, then choose a compression tier by input pressure.

    The input budget is the model context window minus output reservation and a
    small provider/tokenizer safety margin. Compression starts proactively at
    70% of that budget and becomes progressively denser at 85%, 100%, and 120%.
    """

    def __init__(
        self,
        context_window_tokens: int,
        max_output_tokens: int,
        *,
        safety_ratio: float = 0.03,
        input_budget_override: int | None = None,
    ) -> None:
        self.context_window_tokens = max(1024, int(context_window_tokens))
        self.max_output_tokens = max(0, int(max_output_tokens))
        self.safety_ratio = max(0.0, min(0.20, float(safety_ratio)))
        self.input_budget_override = (
            max(256, int(input_budget_override))
            if input_budget_override is not None
            else None
        )

    @property
    def reserved_output_tokens(self) -> int:
        if self.input_budget_override is not None:
            return 0
        # Reserve the configured output ceiling while always leaving a minimal
        # input budget. Otherwise large-output profiles do not compress enough
        # input for the request they actually send to the provider.
        maximum_reservation = max(
            0,
            self.context_window_tokens - self.safety_tokens - 1024,
        )
        return min(self.max_output_tokens, maximum_reservation)

    @property
    def safety_tokens(self) -> int:
        if self.input_budget_override is not None:
            return 0
        return max(512, int(self.context_window_tokens * self.safety_ratio))

    @property
    def input_budget_tokens(self) -> int:
        if self.input_budget_override is not None:
            return self.input_budget_override
        available = (
            self.context_window_tokens
            - self.reserved_output_tokens
            - self.safety_tokens
        )
        return max(1024, available)

    def plan(self, used_tokens: int) -> ContextBudgetPlan:
        used = max(0, int(used_tokens))
        budget = self.input_budget_tokens
        usage_ratio = used / budget if budget else 0.0
        spec = next(
            tier for tier in _TIER_SPECS if usage_ratio <= tier.upper_usage_ratio
        )
        target_tokens = budget
        if spec.level:
            target_tokens = max(256, min(budget, int(budget * spec.target_ratio)))
        return ContextBudgetPlan(
            context_window_tokens=self.context_window_tokens,
            reserved_output_tokens=self.reserved_output_tokens,
            safety_tokens=self.safety_tokens,
            input_budget_tokens=budget,
            used_tokens=used,
            usage_ratio=usage_ratio,
            level=spec.level,
            target_ratio=spec.target_ratio,
            target_tokens=target_tokens,
            memory_ratio=spec.memory_ratio,
            recent_ratio=spec.recent_ratio,
        )
