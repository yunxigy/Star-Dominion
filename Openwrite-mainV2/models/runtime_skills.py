"""Strict contracts for declarative Runtime Skills and project Rules."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SkillBudgetV1(StrictModel):
    max_instruction_chars: int = Field(default=6000, ge=256, le=50000)
    max_reference_chars: int = Field(default=8000, ge=0, le=100000)
    max_tool_calls: int = Field(default=20, ge=1, le=100)


class SkillManifestV1(StrictModel):
    schema_version: Literal[1] = 1
    id: str = Field(pattern=r"^[a-z][a-z0-9_-]{1,63}$")
    version: str = Field(pattern=r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    enabled: bool = True
    agents: tuple[str, ...] = ()
    tasks: tuple[str, ...] = ()
    intents: tuple[str, ...] = ()
    document_types: tuple[str, ...] = ()
    allow_tools: tuple[str, ...] = ()
    requires: tuple[str, ...] = ()
    conflicts_with: tuple[str, ...] = ()
    instructions_file: str = "instructions.md"
    references: tuple[str, ...] = ()
    output_contract: str = Field(default="text", max_length=120)
    budget: SkillBudgetV1 = Field(default_factory=SkillBudgetV1)


class SkillDiagnosticV1(StrictModel):
    code: Literal[
        "invalid_manifest",
        "duplicate_skill",
        "missing_dependency",
        "dependency_cycle",
        "conflict",
        "disabled",
        "unsafe_path",
        "budget_exceeded",
        "unknown_skill",
    ]
    severity: Literal["warning", "error"] = "error"
    skill_id: str = ""
    message: str
    source: str = ""


class ResolvedSkillV1(StrictModel):
    id: str
    version: str
    layer: Literal["builtin", "global", "project"]
    instructions: str = ""
    references: tuple[str, ...] = ()
    allow_tools: tuple[str, ...] = ()
    output_contract: str = "text"
    budget: SkillBudgetV1 = Field(default_factory=SkillBudgetV1)


class SkillResolutionV1(StrictModel):
    schema_version: Literal[1] = 1
    resolution_id: str
    agent: str
    task: str = ""
    intent: str = ""
    document_type: str = ""
    skills: tuple[ResolvedSkillV1, ...] = ()
    allowed_tools: tuple[str, ...] = ()
    instructions: str = ""
    output_contracts: tuple[str, ...] = ()
    budget: SkillBudgetV1 = Field(default_factory=SkillBudgetV1)
    reasons: tuple[str, ...] = ()
    diagnostics: tuple[SkillDiagnosticV1, ...] = ()


class RuleEntryV1(StrictModel):
    text: str = Field(min_length=1, max_length=2000)
    source: str
    line: int = Field(ge=1)


class CompiledRulesV1(StrictModel):
    schema_version: Literal[1] = 1
    revision: str
    mechanical_constraints: tuple[RuleEntryV1, ...] = ()
    semantic_preferences: tuple[RuleEntryV1, ...] = ()
    source_paths: tuple[str, ...] = ()


class RulePreviewV1(StrictModel):
    schema_version: Literal[1] = 1
    preview_id: str
    base_revision: str
    compiled: CompiledRulesV1
    unified_diff: str
    requires_confirmation: bool = True

