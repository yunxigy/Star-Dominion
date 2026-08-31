"""Versioned canonical runtime state and chapter-local delta models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RuntimeNote(StrictModel):
    id: str
    text: str
    source_chapter: str = ""
    status: Literal["active", "resolved"] = "active"


class CharacterRuntimeState(StrictModel):
    name: str
    state: str = ""
    location: str = ""
    knowledge: list[str] = Field(default_factory=list)
    source_chapter: str = ""


class ResourceRuntimeState(StrictModel):
    name: str
    owner: str = ""
    status: str = ""
    quantity: float | int | None = None
    source_chapter: str = ""


class RelationshipRuntimeState(StrictModel):
    source: str
    target: str
    status: str
    tension: str = ""
    source_chapter: str = ""


class OpenThreadRuntimeState(StrictModel):
    title: str
    status: Literal["open", "resolved"] = "open"
    detail: str = ""
    source_chapter: str = ""


class ForeshadowingRuntimeReference(StrictModel):
    title: str
    status: Literal["planted", "advanced", "resolved"] = "planted"
    reference: str = ""
    source_chapter: str = ""


class TimelineRuntimeEvent(StrictModel):
    id: str
    chapter_id: str
    event: str
    story_time: str = ""


class ProposedEntity(StrictModel):
    name: str
    entity_type: Literal["character", "place", "organization", "item", "unknown"] = "unknown"
    reason: str = ""
    source_chapter: str = ""


class RuntimeState(StrictModel):
    schema_version: Literal[1] = 1
    revision: int = 0
    novel_id: str = ""
    source_chapter: str = ""
    updated_at: str = ""
    legacy_documents: dict[str, str] = Field(default_factory=dict)
    current_state_notes: list[RuntimeNote] = Field(default_factory=list)
    ledger_notes: list[RuntimeNote] = Field(default_factory=list)
    relationship_notes: list[RuntimeNote] = Field(default_factory=list)
    characters: dict[str, CharacterRuntimeState] = Field(default_factory=dict)
    resources: dict[str, ResourceRuntimeState] = Field(default_factory=dict)
    relationships: dict[str, RelationshipRuntimeState] = Field(default_factory=dict)
    open_threads: dict[str, OpenThreadRuntimeState] = Field(default_factory=dict)
    foreshadowing_refs: dict[str, ForeshadowingRuntimeReference] = Field(default_factory=dict)
    timeline: list[TimelineRuntimeEvent] = Field(default_factory=list)
    proposed_entities: dict[str, ProposedEntity] = Field(default_factory=dict)


RuntimeCollection = Literal[
    "current_state",
    "ledger",
    "relationships",
    "characters",
    "resources",
    "relationship_states",
    "open_threads",
    "foreshadowing_refs",
    "timeline",
    "proposed_entities",
]

OBJECT_VALUE_COLLECTIONS = {
    "characters",
    "resources",
    "relationship_states",
    "open_threads",
    "foreshadowing_refs",
    "proposed_entities",
    "timeline",
}

RUNTIME_VALUE_MODELS = {
    "characters": CharacterRuntimeState,
    "resources": ResourceRuntimeState,
    "relationship_states": RelationshipRuntimeState,
    "open_threads": OpenThreadRuntimeState,
    "foreshadowing_refs": ForeshadowingRuntimeReference,
    "proposed_entities": ProposedEntity,
    "timeline": TimelineRuntimeEvent,
}


class RuntimeDeltaOperation(StrictModel):
    op: Literal["set", "append", "remove", "resolve", "propose"]
    collection: RuntimeCollection
    target: str = ""
    value: Any = None

    @model_validator(mode="after")
    def validate_operation(self) -> RuntimeDeltaOperation:
        if self.op in {"remove", "resolve"} and not self.target.strip():
            raise ValueError(f"{self.op} operation requires target")
        if self.op in {"set", "append", "propose"} and self.value is None:
            raise ValueError(f"{self.op} operation requires value")
        if self.op == "propose" and self.collection != "proposed_entities":
            raise ValueError("propose operation must target proposed_entities")
        if (
            self.op in {"set", "append", "propose"}
            and self.collection in OBJECT_VALUE_COLLECTIONS
            and not isinstance(self.value, dict)
        ):
            raise ValueError(f"{self.collection} operation requires an object value")
        if (
            self.op in {"set", "append", "propose"}
            and self.collection in RUNTIME_VALUE_MODELS
        ):
            try:
                RUNTIME_VALUE_MODELS[self.collection].model_validate(self.value)
            except ValueError as exc:
                raise ValueError(
                    f"{self.collection} operation has an invalid value schema: {exc}"
                ) from exc
        return self


class RuntimeStateDelta(StrictModel):
    schema_version: Literal[1] = 1
    chapter_id: str
    source_revision: int | None = None
    operations: list[RuntimeDeltaOperation] = Field(default_factory=list)
