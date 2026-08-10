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


def timed_status(
    rule: LorebookRule,
    records: Iterable[ActivationRecord],
    current_sequence: int,
) -> str | None:
    matching = [
        record
        for record in records
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


def choose_group(
    items: list[tuple[LorebookRule, str, int]],
    random_value: Callable[[], float],
) -> tuple[LorebookRule, str, int]:
    stable_priority = lambda item: (
        -item[0].priority,
        item[0].order,
        item[0].id,
    )
    if any(item[0].group_prioritized for item in items):
        return sorted(items, key=stable_priority)[0]

    total = sum(max(0, item[0].group_weight) for item in items)
    if total <= 0:
        return sorted(items, key=lambda item: item[0].id)[0]

    target = random_value() * total
    cursor = 0
    ordered = sorted(items, key=lambda item: item[0].id)
    for item in ordered:
        cursor += max(0, item[0].group_weight)
        if target < cursor:
            return item
    return ordered[-1]


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
        records = tuple(prior_activations)
        scanned = history[-scan_depth:] if scan_depth > 0 else []
        base_scan_text = "\n".join(
            [item["content"] for item in scanned] + [current_input]
        )
        result = LorebookEvaluation()
        candidates: dict[str, tuple[LorebookRule, str, int]] = {}
        retry_in_recursion: set[str] = set()

        for rule in rules:
            status = timed_status(rule, records, current_sequence)
            if status == "sticky_active":
                candidates[rule.id] = (rule, status, 0)
                continue
            if status == "cooldown_active":
                result.trace.append(
                    TraceRecord(rule.id, "skipped", status)
                )
                continue
            if current_sequence < rule.delay:
                result.trace.append(
                    TraceRecord(rule.id, "skipped", "delay_not_reached")
                )
                continue
            if rule.recursion_only:
                result.trace.append(
                    TraceRecord(rule.id, "skipped", "recursion_only")
                )
                retry_in_recursion.add(rule.id)
                continue

            matched = match_rule(rule, base_scan_text)
            if matched.error:
                result.trace.append(
                    TraceRecord(rule.id, "error", matched.error)
                )
                continue
            if not matched.matched:
                result.trace.append(
                    TraceRecord(rule.id, "skipped", matched.reason)
                )
                if not rule.exclude_recursion:
                    retry_in_recursion.add(rule.id)
                continue
            if rule.probability < 1.0 and self.random_value() >= rule.probability:
                result.trace.append(
                    TraceRecord(rule.id, "skipped", "probability_rejected")
                )
                continue
            candidates[rule.id] = (rule, matched.reason, 0)

        if recursive_scan and candidates and max_recursion_steps > 0:
            scan_text = base_scan_text
            new_content = [
                item[0].content
                for item in candidates.values()
                if not item[0].prevent_recursion
            ]
            for level in range(1, max_recursion_steps + 1):
                if not new_content:
                    break
                scan_text = "\n".join([scan_text, *new_content])
                new_content = []
                for rule in rules:
                    if rule.id not in retry_in_recursion or rule.id in candidates:
                        continue
                    if rule.exclude_recursion:
                        continue
                    matched = match_rule(rule, scan_text)
                    if matched.error:
                        result.trace.append(
                            TraceRecord(rule.id, "error", matched.error, level)
                        )
                        retry_in_recursion.discard(rule.id)
                        continue
                    if not matched.matched:
                        continue
                    if (
                        rule.probability < 1.0
                        and self.random_value() >= rule.probability
                    ):
                        result.trace.append(
                            TraceRecord(
                                rule.id,
                                "skipped",
                                "probability_rejected",
                                level,
                            )
                        )
                        retry_in_recursion.discard(rule.id)
                        continue
                    candidates[rule.id] = (rule, matched.reason, level)
                    retry_in_recursion.discard(rule.id)
                    if not rule.prevent_recursion:
                        new_content.append(rule.content)

        grouped: dict[str, list[tuple[LorebookRule, str, int]]] = {}
        for candidate in candidates.values():
            if candidate[0].group:
                grouped.setdefault(candidate[0].group, []).append(candidate)
        for items in grouped.values():
            if len(items) < 2:
                continue
            selected = choose_group(items, self.random_value)
            for item in items:
                if item[0].id == selected[0].id:
                    continue
                candidates.pop(item[0].id, None)
                result.trace.append(
                    TraceRecord(
                        item[0].id,
                        "skipped",
                        "group_not_selected",
                        item[2],
                    )
                )

        return self._finalize(list(candidates.values()), result, token_budget)

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
