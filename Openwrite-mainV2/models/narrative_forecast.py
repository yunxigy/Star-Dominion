"""Strict contracts for non-canonical multi-branch narrative forecasts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ForecastBeatV1(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    offset: int = Field(ge=1, le=10)
    chapter_id: str = Field(default="", max_length=80)
    summary: str = Field(min_length=1, max_length=2000)


class ForecastCharacterDecisionV1(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    character: str = Field(min_length=1, max_length=160)
    decision: str = Field(min_length=1, max_length=2000)


class ForecastProjectedChangesV1(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    characters: tuple[str, ...] = ()
    relationships: tuple[str, ...] = ()
    world: tuple[str, ...] = ()
    foreshadowing: tuple[str, ...] = ()


class ForecastRiskV1(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    kind: Literal["continuity", "causality", "character"]
    description: str = Field(min_length=1, max_length=2000)


class ForecastIntentAlignmentV1(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    score: int = Field(ge=0, le=100)
    rationale: str = Field(min_length=1, max_length=2000)


class ForecastBranchV1(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    branch_id: str = Field(pattern=r"^branch-[1-5]$")
    title: str = Field(min_length=1, max_length=160)
    premise: str = Field(min_length=1, max_length=3000)
    beats: tuple[ForecastBeatV1, ...] = Field(min_length=1, max_length=10)
    character_decisions: tuple[ForecastCharacterDecisionV1, ...] = ()
    projected_changes: ForecastProjectedChangesV1
    risks: tuple[ForecastRiskV1, ...] = ()
    uncertainties: tuple[str, ...] = ()
    intent_alignment: ForecastIntentAlignmentV1


class NarrativeForecastV1(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    schema_version: Literal[1] = 1
    forecast_id: str = Field(pattern=r"^forecast_[A-Za-z0-9_-]+$")
    novel_id: str
    created_at: str
    divergence: str = Field(min_length=1, max_length=4000)
    branch_count: int = Field(ge=2, le=5)
    horizon: int = Field(ge=1, le=10)
    anchor_chapter_id: str = Field(default="", max_length=80)
    anchor_chapter_title: str = Field(default="", max_length=500)
    anchor_chapter_status: str = Field(default="", max_length=40)
    anchor_chapter_number: int = Field(default=0, ge=0)
    anchor_chapter_path: tuple[str, ...] = ()
    base_chapter: int = Field(ge=0)
    outline_revision: str
    facts_revision: str
    context_fingerprint: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    context_brief: str = Field(min_length=1)
    state: Literal["candidate", "active", "stale"] = "candidate"
    branches: tuple[ForecastBranchV1, ...] = ()
    selected_branch_id: str = ""
    selected_at: str = ""

    @model_validator(mode="after")
    def validate_branch_contract(self) -> NarrativeForecastV1:
        if self.state == "candidate" and self.branches:
            raise ValueError("candidate forecast cannot contain staged branches")
        if self.state == "active" and len(self.branches) != self.branch_count:
            raise ValueError("active forecast branch count does not match branch_count")
        if self.state == "stale" and self.branches and len(self.branches) != self.branch_count:
            raise ValueError("stale forecast branch count does not match branch_count")

        branch_ids = [branch.branch_id for branch in self.branches]
        if len(branch_ids) != len(set(branch_ids)):
            raise ValueError("forecast branch ids must be unique")
        for branch in self.branches:
            if any(beat.offset > self.horizon for beat in branch.beats):
                raise ValueError("forecast beat offset exceeds horizon")
            offsets = [beat.offset for beat in branch.beats]
            if len(offsets) != len(set(offsets)):
                raise ValueError("forecast beat offsets must be unique within a branch")
        if self.selected_branch_id and self.selected_branch_id not in branch_ids:
            raise ValueError("selected branch does not exist in forecast")
        return self
