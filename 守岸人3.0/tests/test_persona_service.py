import pytest

from server.models.persona import Persona, PersonaBinding
from server.services.persona_service import PersonaNotFound, PersonaService


@pytest.fixture
def persona_graph(db_session, seeded_chat):
    personas = [
        Persona(id="default", user_id=seeded_chat.owner.id, name="Default", is_default=True),
        Persona(id="character", user_id=seeded_chat.owner.id, name="Character"),
        Persona(id="chat", user_id=seeded_chat.owner.id, name="Chat"),
        Persona(id="temporary", user_id=seeded_chat.owner.id, name="Temporary"),
    ]
    bindings = [
        PersonaBinding(id="bc", user_id=seeded_chat.owner.id, persona_id="character", scope_type="character", scope_id=seeded_chat.character.id),
        PersonaBinding(id="bs", user_id=seeded_chat.owner.id, persona_id="chat", scope_type="chat", scope_id=seeded_chat.session.id),
    ]
    db_session.add_all([*personas, *bindings]); db_session.commit()
    return seeded_chat


def test_persona_selection_precedence(db_session, persona_graph):
    service = PersonaService(db_session, owner_id=persona_graph.owner.id)
    selected = service.select(character_id=persona_graph.character.id, session_id=persona_graph.session.id)
    assert (selected.persona.id, selected.source) == ("chat", "chat")
    service.clear_binding("chat", persona_graph.session.id)
    assert service.select(character_id=persona_graph.character.id, session_id=persona_graph.session.id).source == "character"
    service.clear_binding("character", persona_graph.character.id)
    assert service.select(character_id=persona_graph.character.id, session_id=persona_graph.session.id).source == "default"


def test_temporary_persona_does_not_replace_binding(db_session, persona_graph):
    service = PersonaService(db_session, owner_id=persona_graph.owner.id)
    selected = service.select(character_id=persona_graph.character.id, session_id=persona_graph.session.id, temporary_persona_id="temporary")
    assert selected.source == "temporary"
    assert service.binding("chat", persona_graph.session.id).persona_id == "chat"


def test_another_user_cannot_read_persona(db_session, persona_graph):
    service = PersonaService(db_session, owner_id="not-owner")
    with pytest.raises(PersonaNotFound):
        service.owned_persona("default")
