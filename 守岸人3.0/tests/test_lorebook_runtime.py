from server.models.chat_db import ChatSession
from server.models.lorebook import (
    Lorebook,
    LorebookActivationEvent,
    LorebookBinding,
    LorebookEntry,
)
from server.services.lorebook_runtime import LorebookRuntime
from server.services.lorebook_types import (
    EvaluatedEntry,
    LorebookEvaluation,
    LorebookRule,
)


def test_runtime_uses_only_events_on_active_path(db_session, seeded_chat):
    event = LorebookActivationEvent(
        session_id=seeded_chat.session.id,
        entry_id="sticky-entry",
        response_message_id=seeded_chat.assistant_message.id,
        entry_revision=2,
        trigger_sequence=1,
        sticky=3,
        cooldown=2,
    )
    db_session.add(event)
    db_session.commit()
    runtime = LorebookRuntime(
        db_session,
        owner_id=seeded_chat.owner.id,
        random_value=lambda: 0.0,
    )

    inherited = runtime.activation_records(
        seeded_chat.session.id,
        active_message_ids={seeded_chat.assistant_message.id},
    )
    discarded = runtime.activation_records(
        seeded_chat.session.id,
        active_message_ids={seeded_chat.user_message.id},
    )

    assert [item.entry_id for item in inherited] == ["sticky-entry"]
    assert discarded == []


def test_record_evaluation_is_idempotent(db_session, seeded_chat):
    rule = LorebookRule(
        "sticky-entry",
        "stays",
        ("shore",),
        sticky=3,
        revision=2,
    )
    evaluation = LorebookEvaluation(
        entries=[EvaluatedEntry(rule, "matched", 2)],
        used_tokens=2,
    )
    runtime = LorebookRuntime(
        db_session,
        owner_id=seeded_chat.owner.id,
        random_value=lambda: 0.0,
    )

    runtime.record_evaluation(
        seeded_chat.session.id,
        seeded_chat.assistant_message,
        evaluation,
    )
    runtime.record_evaluation(
        seeded_chat.session.id,
        seeded_chat.assistant_message,
        evaluation,
    )

    events = db_session.query(LorebookActivationEvent).all()
    assert len(events) == 1
    assert events[0].trigger_sequence == 1


def test_sticky_carry_forward_does_not_renew_trigger_sequence(
    db_session,
    seeded_chat,
):
    rule = LorebookRule(
        "sticky-entry",
        "stays",
        ("shore",),
        sticky=3,
        revision=2,
    )
    evaluation = LorebookEvaluation(
        entries=[EvaluatedEntry(rule, "sticky_active", 2)],
        used_tokens=2,
    )
    runtime = LorebookRuntime(
        db_session,
        owner_id=seeded_chat.owner.id,
        random_value=lambda: 0.0,
    )

    runtime.record_evaluation(
        seeded_chat.session.id,
        seeded_chat.assistant_message,
        evaluation,
    )

    assert db_session.query(LorebookActivationEvent).count() == 0


def test_runtime_combines_character_default_and_chat_bound_books(
    db_session,
    seeded_chat,
):
    default_book = Lorebook(
        id="default-book",
        character_id=seeded_chat.character.id,
        name="Default",
        is_character_default=True,
    )
    chat_book = Lorebook(
        id="chat-book",
        character_id=seeded_chat.character.id,
        name="Chat only",
        is_character_default=False,
    )
    default_entry = LorebookEntry(
        id="character-default-entry",
        lorebook_id=default_book.id,
        keyword="default",
        content="default",
    )
    chat_entry = LorebookEntry(
        id="chat-bound-entry",
        lorebook_id=chat_book.id,
        keyword="bound",
        content="bound",
    )
    binding = LorebookBinding(
        lorebook_id=chat_book.id,
        scope_type="chat",
        scope_id=seeded_chat.session.id,
    )
    other_session = ChatSession(
        id="other-session",
        user_id=seeded_chat.owner.id,
        character_id=seeded_chat.character.id,
        version=1,
    )
    db_session.add_all(
        [
            default_book,
            chat_book,
            default_entry,
            chat_entry,
            binding,
            other_session,
        ]
    )
    db_session.commit()
    runtime = LorebookRuntime(
        db_session,
        owner_id=seeded_chat.owner.id,
        random_value=lambda: 0.0,
    )

    current_ids = {
        rule.id
        for rule in runtime.rules_for_context(
            character_id=seeded_chat.character.id,
            session_id=seeded_chat.session.id,
        )
    }
    other_ids = {
        rule.id
        for rule in runtime.rules_for_context(
            character_id=seeded_chat.character.id,
            session_id=other_session.id,
        )
    }

    assert current_ids == {"character-default-entry", "chat-bound-entry"}
    assert other_ids == {"character-default-entry"}
