from collections.abc import Callable, Iterable

from .lorebook_matcher import match_rule
from .lorebook_types import (
    ActivationRecord,
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
        prior_activations: Iterable[ActivationRecord] = (),
        recursive_scan: bool = True,
        max_recursion_steps: int = 3,
    ) -> LorebookEvaluation:
        del prior_activations, recursive_scan, max_recursion_steps
        scanned = history[-scan_depth:] if scan_depth > 0 else []
        scan_text = "\n".join(
            [item["content"] for item in scanned] + [current_input]
        )
        result = LorebookEvaluation()
        candidates: list[tuple[LorebookRule, str, int]] = []

        for rule in rules:
            if rule.recursion_only:
                result.trace.append(
                    TraceRecord(rule.id, "skipped", "recursion_only")
                )
                continue
            if current_sequence < rule.delay:
                result.trace.append(
                    TraceRecord(rule.id, "skipped", "delay_not_reached")
                )
                continue

            matched = match_rule(rule, scan_text)
            if matched.error:
                result.trace.append(
                    TraceRecord(rule.id, "error", matched.error)
                )
                continue
            if not matched.matched:
                result.trace.append(
                    TraceRecord(rule.id, "skipped", matched.reason)
                )
                continue
            if rule.probability < 1.0 and self.random_value() >= rule.probability:
                result.trace.append(
                    TraceRecord(rule.id, "skipped", "probability_rejected")
                )
                continue
            candidates.append((rule, matched.reason, 0))

        return self._finalize(candidates, result, token_budget)

    def _finalize(
        self,
        candidates: list[tuple[LorebookRule, str, int]],
        result: LorebookEvaluation,
        token_budget: int,
    ) -> LorebookEvaluation:
        ordered = sorted(
            candidates,
            key=lambda item: (-item[0].priority, item[0].order, item[0].id),
        )
        for rule, reason, level in ordered:
            cost = estimate_tokens(rule.content)
            if result.used_tokens + cost > token_budget:
                result.trace.append(
                    TraceRecord(
                        rule.id,
                        "skipped",
                        "token_budget_exceeded",
                        level,
                        cost,
                    )
                )
                continue
            result.entries.append(EvaluatedEntry(rule, reason, cost))
            result.used_tokens += cost
            result.trace.append(
                TraceRecord(rule.id, "activated", reason, level, cost)
            )
        return result
