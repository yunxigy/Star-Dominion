"""Runtime Skill and project Rule resolution.

Skills are declarative resources. They can select registered tools and bounded
instructions, but never grant permissions beyond the caller's baseline.
"""

from .resolver import (
    RuleCompiler,
    RuntimeSkillResolver,
    extract_explicit_skill_mentions,
    render_runtime_context,
    resolve_runtime,
)

__all__ = [
    "RuleCompiler",
    "RuntimeSkillResolver",
    "extract_explicit_skill_mentions",
    "render_runtime_context",
    "resolve_runtime",
]
