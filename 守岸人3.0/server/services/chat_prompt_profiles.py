from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.chat_db import ChatSession
from ..models.persona import ModelProfile, PromptBlock, PromptPreset
from .persona_service import PersonaNotFound, PersonaService
from .prompt_composer import PromptBlockInput, PromptComposer


class ChatPromptProfileNotFound(LookupError):
    pass


@dataclass
class ChatPromptProfile:
    persona_entry: dict | None = None
    system_additions: list[str] = field(default_factory=list)
    message_additions: list[dict[str, str]] = field(default_factory=list)
    llm_options: dict = field(default_factory=dict)


def resolve_chat_prompt_profile(
    db: Session,
    *,
    owner_id: str,
    session: ChatSession,
    temporary_persona_id: str | None,
    model_profile_id: str | None,
) -> ChatPromptProfile:
    result = ChatPromptProfile()
    try:
        selected = PersonaService(db, owner_id=owner_id).select(
            character_id=session.character_id,
            session_id=session.id,
            temporary_persona_id=temporary_persona_id,
        )
    except PersonaNotFound as exc:
        raise ChatPromptProfileNotFound(str(exc)) from exc
    if selected.persona is not None:
        persona = selected.persona
        content = f"【用户扮演身份：{persona.name}】"
        if persona.description.strip():
            content += f"\n{persona.description.strip()}"
        result.persona_entry = {
            "id": f"persona:{persona.id}",
            "content": content,
            "position": persona.injection_position,
            "depth": persona.depth,
            "order": -100,
        }

    if not model_profile_id:
        return result
    profile = db.scalar(
        select(ModelProfile).where(
            ModelProfile.id == model_profile_id,
            ModelProfile.user_id == owner_id,
        )
    )
    if profile is None:
        raise ChatPromptProfileNotFound("model profile not found")
    parameters = profile.parameters or {}
    result.llm_options = {
        "backend": profile.provider,
        "model": profile.model,
        **{
            key: parameters[key]
            for key in (
                "max_tokens",
                "temperature",
                "top_p",
                "frequency_penalty",
                "presence_penalty",
            )
            if key in parameters
        },
    }
    if not profile.prompt_preset_id:
        return result
    preset = db.scalar(
        select(PromptPreset).where(
            PromptPreset.id == profile.prompt_preset_id,
            PromptPreset.user_id == owner_id,
        )
    )
    if preset is None:
        raise ChatPromptProfileNotFound("prompt preset not found")
    rows = db.scalars(
        select(PromptBlock)
        .where(PromptBlock.preset_id == preset.id)
        .order_by(PromptBlock.sort_order, PromptBlock.id)
    ).all()
    blocks = [
        PromptBlockInput(
            row.id,
            row.kind,
            row.content,
            row.sort_order,
            row.role,
            row.enabled,
        )
        for row in rows
    ]
    composition = PromptComposer().compose(
        blocks=blocks,
        token_budget=preset.token_budget,
    )
    for block in composition.included:
        if block.role == "system":
            result.system_additions.append(block.content)
        else:
            result.message_additions.append(
                {"role": block.role, "content": block.content}
            )
    return result
