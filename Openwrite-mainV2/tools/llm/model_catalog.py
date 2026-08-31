"""Curated Studio model presets checked against LiteLLM's local metadata."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

MAX_CONTEXT_TOKENS = 10_000_000
# Application validation ceiling; provider presets retain their verified caps.
MAX_OUTPUT_TOKENS = MAX_CONTEXT_TOKENS


@dataclass(frozen=True)
class ModelPresetSpec:
    preset_id: str
    label: str
    family: str
    provider: str
    base_url: str
    model: str
    litellm_model: str
    fallback_context_tokens: int
    fallback_output_tokens: int
    api_format: str = "chat"
    description: str = ""
    output_limit_known: bool = True


CURATED_MODEL_PRESETS = (
    ModelPresetSpec(
        "openai-gpt-5.6-sol",
        "GPT-5.6 Sol · 旗舰",
        "OpenAI · GPT-5.6",
        "openai",
        "https://api.openai.com/v1",
        "gpt-5.6-sol",
        "gpt-5.6-sol",
        1_050_000,
        128_000,
        description="复杂推理、编程与专业工作",
    ),
    ModelPresetSpec(
        "openai-gpt-5.6-terra",
        "GPT-5.6 Terra · 均衡",
        "OpenAI · GPT-5.6",
        "openai",
        "https://api.openai.com/v1",
        "gpt-5.6-terra",
        "gpt-5.6-terra",
        1_050_000,
        128_000,
        description="能力、速度与成本平衡",
    ),
    ModelPresetSpec(
        "openai-gpt-5.6-luna",
        "GPT-5.6 Luna · 高吞吐",
        "OpenAI · GPT-5.6",
        "openai",
        "https://api.openai.com/v1",
        "gpt-5.6-luna",
        "gpt-5.6-luna",
        1_050_000,
        128_000,
        description="低成本批量任务",
    ),
    ModelPresetSpec(
        "anthropic-claude-fable-5",
        "Claude Fable 5 · 最高能力",
        "Anthropic · Claude",
        "anthropic",
        "https://api.anthropic.com",
        "claude-fable-5",
        "claude-fable-5",
        1_000_000,
        128_000,
        description="长程 Agent 与最高难度任务",
    ),
    ModelPresetSpec(
        "anthropic-claude-opus-5",
        "Claude Opus 5 · 专业",
        "Anthropic · Claude",
        "anthropic",
        "https://api.anthropic.com",
        "claude-opus-5",
        "claude-opus-5",
        1_000_000,
        128_000,
        description="复杂编程与企业任务",
    ),
    ModelPresetSpec(
        "anthropic-claude-sonnet-5",
        "Claude Sonnet 5 · 均衡",
        "Anthropic · Claude",
        "anthropic",
        "https://api.anthropic.com",
        "claude-sonnet-5",
        "claude-sonnet-5",
        1_000_000,
        128_000,
        description="速度和智能的主力平衡档",
    ),
    ModelPresetSpec(
        "anthropic-claude-haiku-4.5",
        "Claude Haiku 4.5 · 低延迟",
        "Anthropic · Claude",
        "anthropic",
        "https://api.anthropic.com",
        "claude-haiku-4-5",
        "claude-haiku-4-5",
        200_000,
        64_000,
        description="快速、低价的轻量任务",
    ),
    ModelPresetSpec(
        "google-gemini-3.1-pro-preview",
        "Gemini 3.1 Pro Preview · 高能力",
        "Google · Gemini",
        "openai",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "gemini-3.1-pro-preview",
        "gemini/gemini-3.1-pro-preview",
        1_048_576,
        65_536,
        description="复杂推理与多模态任务",
    ),
    ModelPresetSpec(
        "google-gemini-3.6-flash",
        "Gemini 3.6 Flash · 高速",
        "Google · Gemini",
        "openai",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "gemini-3.6-flash",
        "gemini/gemini-3.6-flash",
        1_048_576,
        65_536,
        description="高速生成与 Agent 循环",
    ),
    ModelPresetSpec(
        "deepseek-v4-pro",
        "DeepSeek V4 Pro · 旗舰",
        "DeepSeek · V4",
        "openai",
        "https://api.deepseek.com",
        "deepseek-v4-pro",
        "deepseek/deepseek-v4-pro",
        1_000_000,
        384_000,
        description="复杂推理与长输出",
    ),
    ModelPresetSpec(
        "deepseek-v4-flash",
        "DeepSeek V4 Flash · 高速",
        "DeepSeek · V4",
        "openai",
        "https://api.deepseek.com",
        "deepseek-v4-flash",
        "deepseek/deepseek-v4-flash",
        1_000_000,
        384_000,
        description="高速长上下文与长输出",
    ),
    ModelPresetSpec(
        "dashscope-qwen3.8-max",
        "Qwen3.8-Max · 旗舰",
        "国内前沿",
        "openai",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "qwen3.8-max",
        "dashscope/qwen3.8-max",
        1_000_000,
        131_072,
        description="通义千问综合旗舰",
    ),
    ModelPresetSpec(
        "moonshot-kimi-k3",
        "Kimi K3 · 旗舰",
        "国内前沿",
        "openai",
        "https://api.moonshot.cn/v1",
        "kimi-k3",
        "moonshot/kimi-k3",
        1_048_576,
        131_072,
        description="超长上下文与综合创作",
    ),
    ModelPresetSpec(
        "zhipu-glm-5.2",
        "GLM-5.2 · 长程 Agent",
        "国内前沿",
        "openai",
        "https://open.bigmodel.cn/api/paas/v4",
        "glm-5.2",
        "zai/glm-5.2",
        1_000_000,
        128_000,
        description="长程 Coding Agent",
    ),
    ModelPresetSpec(
        "volcengine-doubao-seed-2.1-pro",
        "Doubao Seed 2.1 Pro · 旗舰",
        "国内前沿",
        "openai",
        "https://ark.cn-beijing.volces.com/api/v3",
        "doubao-seed-2-1-pro",
        "volcengine/doubao-seed-2-1-pro",
        1_048_576,
        262_144,
        description="火山方舟长上下文旗舰",
    ),
    ModelPresetSpec(
        "minimax-m3",
        "MiniMax M3 · Agent",
        "国内前沿",
        "openai",
        "https://api.minimaxi.com/v1",
        "MiniMax-M3",
        "minimax/MiniMax-M3",
        1_000_000,
        128_000,
        description="Coding、Agent 与多模态任务",
        output_limit_known=False,
    ),
    ModelPresetSpec(
        "xiaomi-mimo-v2.5",
        "MiMo-V2.5 · 高性价比",
        "国内前沿",
        "openai",
        "https://api.xiaomimimo.com/v1",
        "mimo-v2.5",
        "xiaomi/mimo-v2.5",
        1_000_000,
        128_000,
        description="低成本、高吞吐的 Agent 模型",
    ),
    ModelPresetSpec(
        "xiaomi-mimo-v2.5-pro",
        "MiMo-V2.5-Pro · 高能力",
        "国内前沿",
        "openai",
        "https://api.xiaomimimo.com/v1",
        "mimo-v2.5-pro",
        "xiaomi/mimo-v2.5-pro",
        1_000_000,
        128_000,
        description="复杂 Agent 与质量优先任务",
    ),
    ModelPresetSpec(
        "xiaomi-mimo-v2.5-pro-ultraspeed",
        "MiMo-V2.5-Pro UltraSpeed · 极速",
        "国内前沿",
        "openai",
        "https://api.xiaomimimo.com/v1",
        "mimo-v2.5-pro-ultraspeed",
        "xiaomi/mimo-v2.5-pro-ultraspeed",
        1_000_000,
        128_000,
        description="Pro 能力的超高速服务档",
    ),
    ModelPresetSpec(
        "xai-grok-4.5",
        "Grok 4.5 · 工程 Agent",
        "国际前沿",
        "openai",
        "https://api.x.ai/v1",
        "grok-4.5",
        "xai/grok-4.5",
        500_000,
        131_072,
        description="编码、工程与 Agent 工作流；输出使用保守预设",
        output_limit_known=False,
    ),
)


@lru_cache(maxsize=1)
def model_preset_catalog() -> list[dict[str, Any]]:
    """Return official presets annotated with local LiteLLM coverage."""

    try:
        import litellm

        model_cost: Mapping[str, Mapping[str, Any]] = getattr(litellm, "model_cost", {})
    except ImportError:
        model_cost = {}
    return build_model_preset_catalog(model_cost)


def build_model_preset_catalog(
    model_cost: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for spec in CURATED_MODEL_PRESETS:
        metadata = model_cost.get(spec.litellm_model) or {}
        provider_context_tokens = spec.fallback_context_tokens
        provider_max_tokens = (
            spec.fallback_output_tokens if spec.output_limit_known else None
        )
        context_tokens = _bounded_tokens(
            provider_context_tokens,
            spec.fallback_context_tokens,
            minimum=12_000,
            maximum=MAX_CONTEXT_TOKENS,
        )
        max_tokens = _bounded_tokens(
            spec.fallback_output_tokens,
            spec.fallback_output_tokens,
            minimum=256,
            maximum=MAX_OUTPUT_TOKENS,
        )
        litellm_context_tokens = _optional_tokens(metadata.get("max_input_tokens"))
        litellm_max_tokens = _optional_tokens(
            metadata.get("max_output_tokens") or metadata.get("max_tokens")
        )
        metadata_status = _metadata_status(
            spec,
            metadata,
            litellm_context_tokens,
            litellm_max_tokens,
        )
        catalog.append(
            {
                "id": spec.preset_id,
                "label": spec.label,
                "family": spec.family,
                "description": spec.description,
                "provider": spec.provider,
                "base_url": spec.base_url,
                "model": spec.model,
                "api_format": spec.api_format,
                "context_tokens": context_tokens,
                "max_tokens": max_tokens,
                "provider_context_tokens": provider_context_tokens,
                "provider_max_tokens": provider_max_tokens,
                "output_limit_known": spec.output_limit_known,
                "application_limited": (
                    context_tokens != provider_context_tokens
                    or (
                        provider_max_tokens is not None
                        and max_tokens != provider_max_tokens
                    )
                ),
                "metadata_source": "official+litellm" if metadata else "official",
                "metadata_status": metadata_status,
                "metadata_model": spec.litellm_model,
                "litellm_context_tokens": litellm_context_tokens,
                "litellm_max_tokens": litellm_max_tokens,
            }
        )
    return catalog


def _metadata_status(
    spec: ModelPresetSpec,
    metadata: Mapping[str, Any],
    context_tokens: int | None,
    max_tokens: int | None,
) -> str:
    if not metadata:
        return "missing"
    context_matches = context_tokens in {None, spec.fallback_context_tokens}
    output_matches = (
        not spec.output_limit_known
        or max_tokens in {None, spec.fallback_output_tokens}
    )
    return "verified" if context_matches and output_matches else "conflict"


def _optional_tokens(value: Any) -> int | None:
    if value in {None, ""}:
        return None
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return None


def _bounded_tokens(value: Any, fallback: int, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value if value not in {None, ""} else fallback)
    except (TypeError, ValueError, OverflowError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))
