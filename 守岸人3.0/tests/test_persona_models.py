from server.models.persona import (
    ModelProfile,
    Persona,
    PersonaBinding,
    PromptBlock,
    PromptPreset,
)


def test_persona_and_prompt_models_round_trip(db_session, seeded_chat):
    persona = Persona(
        id="p1",
        user_id=seeded_chat.owner.id,
        name="Rover",
        description="A traveler",
        injection_position="before_char",
        is_default=True,
    )
    binding = PersonaBinding(
        id="b1",
        user_id=seeded_chat.owner.id,
        persona_id=persona.id,
        scope_type="chat",
        scope_id=seeded_chat.session.id,
    )
    preset = PromptPreset(
        id="preset1",
        user_id=seeded_chat.owner.id,
        name="Roleplay",
        token_budget=4096,
    )
    block = PromptBlock(
        id="block1",
        preset_id=preset.id,
        kind="persona",
        name="Persona",
        enabled=True,
        sort_order=20,
    )
    profile = ModelProfile(
        id="profile1",
        user_id=seeded_chat.owner.id,
        name="DeepSeek",
        provider="siliconflow",
        model="deepseek-v4-flash",
        prompt_preset_id=preset.id,
        parameters={"temperature": 0.8},
    )
    db_session.add_all([persona, binding, preset, block, profile])
    db_session.commit()

    assert persona.to_dict()["is_default"] is True
    assert binding.to_dict()["scope_type"] == "chat"
    assert preset.to_dict()["token_budget"] == 4096
    assert block.to_dict()["kind"] == "persona"
    assert profile.to_dict()["parameters"] == {"temperature": 0.8}
    assert "api_key" not in profile.to_dict()
