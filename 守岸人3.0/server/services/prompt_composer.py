from dataclasses import dataclass, field

from .lorebook_engine import estimate_tokens


@dataclass(frozen=True)
class PromptBlockInput:
    id: str
    kind: str
    content: str
    sort_order: int
    role: str = "system"
    enabled: bool = True


@dataclass(frozen=True)
class PromptTrace:
    block_id: str
    status: str
    reason: str
    estimated_tokens: int


@dataclass
class PromptComposition:
    included: list[PromptBlockInput] = field(default_factory=list)
    trace: list[PromptTrace] = field(default_factory=list)
    used_tokens: int = 0
    metadata: dict = field(default_factory=dict)


class PromptComposer:
    SAFE_METADATA = {"provider", "model", "temperature", "top_p", "max_tokens", "stop_sequence_names"}

    def compose(self, *, blocks: list[PromptBlockInput], token_budget: int) -> PromptComposition:
        result = PromptComposition()
        for block in sorted(blocks, key=lambda item: (item.sort_order, item.id)):
            cost = estimate_tokens(block.content)
            if not block.enabled:
                result.trace.append(PromptTrace(block.id, "skipped", "disabled", cost)); continue
            if not block.content.strip():
                result.trace.append(PromptTrace(block.id, "skipped", "empty", cost)); continue
            if result.used_tokens + cost > token_budget:
                result.trace.append(PromptTrace(block.id, "skipped", "token_budget_exceeded", cost)); continue
            result.included.append(block); result.used_tokens += cost
            result.trace.append(PromptTrace(block.id, "included", "included", cost))
        return result

    def preview(self, *, blocks: list[PromptBlockInput], token_budget: int, metadata: dict) -> PromptComposition:
        result = self.compose(blocks=blocks, token_budget=token_budget)
        result.metadata = {key: value for key, value in metadata.items() if key in self.SAFE_METADATA}
        return result
