from collections.abc import Callable, Iterable

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models.chat_db import ChatMessage
from ..models.lorebook import (
    Lorebook,
    LorebookActivationEvent,
    LorebookBinding,
    LorebookEntry,
)
from .chat_history import ChatHistoryService, ChatResourceNotFound
from .lorebook_engine import LorebookEngine
from .lorebook_matcher import split_keys
from .lorebook_types import (
    ActivationRecord,
    LorebookEvaluation,
    LorebookRule,
)


class LorebookRuntime:
    def __init__(
        self,
        db: Session,
        *,
        owner_id: str,
        random_value: Callable[[], float],
    ):
        self.db = db
        self.owner_id = owner_id
        self.history = ChatHistoryService(db, owner_id=owner_id)
        self.engine = LorebookEngine(random_value=random_value)

    def activation_records(
        self,
        session_id: str,
        *,
        active_message_ids: set[str],
    ) -> list[ActivationRecord]:
        self.history.owned_session(session_id)
        if not active_message_ids:
            return []
        rows = self.db.scalars(
            select(LorebookActivationEvent)
            .where(
                LorebookActivationEvent.session_id == session_id,
                LorebookActivationEvent.response_message_id.in_(active_message_ids),
            )
            .order_by(
                LorebookActivationEvent.trigger_sequence,
                LorebookActivationEvent.id,
            )
        ).all()
        return [
            ActivationRecord(
                row.entry_id,
                row.entry_revision,
                row.trigger_sequence,
                row.sticky,
                row.cooldown,
            )
            for row in rows
        ]

    def _active_books(self, *, character_id: str, session_id: str) -> list[Lorebook]:
        session = self.history.owned_session(session_id)
        if session.character_id != character_id:
            raise ChatResourceNotFound("chat character does not match lorebook context")
        bound_book_ids = select(LorebookBinding.lorebook_id).where(
            LorebookBinding.scope_type == "chat",
            LorebookBinding.scope_id == session_id,
        )
        return list(
            self.db.scalars(
                select(Lorebook)
                .where(
                    Lorebook.character_id == character_id,
                    Lorebook.is_enabled.is_(True),
                    or_(
                        Lorebook.is_character_default.is_(True),
                        Lorebook.id.in_(bound_book_ids),
                    ),
                )
                .order_by(Lorebook.id)
            )
        )

    @staticmethod
    def _to_rule(row: LorebookEntry) -> LorebookRule:
        return LorebookRule(
            id=row.id,
            content=row.content,
            primary_keys=split_keys(row.keyword),
            secondary_keys=split_keys(row.secondary_keyword),
            selective_logic=row.selective_logic or "or",
            constant=bool(row.constant),
            position=row.position or "after_char",
            depth=row.depth or 0,
            order=row.order or 0,
            priority=row.priority or 0,
            probability=1.0 if row.probability is None else float(row.probability),
            sticky=row.sticky or 0,
            cooldown=row.cooldown or 0,
            delay=row.delay or 0,
            group=row.group,
            group_weight=row.group_weight or 0,
            group_prioritized=bool(row.group_prioritized),
            case_sensitive=bool(row.case_sensitive),
            match_whole_words=bool(row.match_whole_words),
            exclude_recursion=bool(row.exclude_recursion),
            prevent_recursion=bool(row.prevent_recursion),
            recursion_only=bool(row.recursion_only),
            revision=row.revision or 1,
        )

    def _rules_for_books(self, books: Iterable[Lorebook]) -> list[LorebookRule]:
        book_ids = [book.id for book in books]
        if not book_ids:
            return []
        rows = self.db.scalars(
            select(LorebookEntry)
            .where(
                LorebookEntry.lorebook_id.in_(book_ids),
                LorebookEntry.is_enabled.is_(True),
            )
            .order_by(
                LorebookEntry.priority.desc(),
                LorebookEntry.order,
                LorebookEntry.id,
            )
        ).all()
        return [self._to_rule(row) for row in rows]

    def rules_for_context(
        self,
        *,
        character_id: str,
        session_id: str,
    ) -> list[LorebookRule]:
        books = self._active_books(
            character_id=character_id,
            session_id=session_id,
        )
        return self._rules_for_books(books)

    def evaluate(
        self,
        session_id: str,
        *,
        current_input: str,
        advance_sequence: bool = True,
        messages: list[ChatMessage] | None = None,
    ) -> LorebookEvaluation:
        session = self.history.owned_session(session_id)
        path = self.history.active_path(session_id) if messages is None else messages
        books = self._active_books(
            character_id=session.character_id,
            session_id=session.id,
        )
        rules = self._rules_for_books(books)
        active_ids = {message.id for message in path}
        prior = self.activation_records(
            session.id,
            active_message_ids=active_ids,
        )
        history = [
            {
                "role": message.role,
                "content": self.history.selected_text(message),
            }
            for message in path
        ]
        user_turns = sum(message.role == "user" for message in path)
        positive_budgets = [book.token_budget for book in books if book.token_budget > 0]
        return self.engine.evaluate(
            rules=rules,
            history=history,
            current_input=current_input,
            scan_depth=max((book.scan_depth or 0 for book in books), default=0),
            current_sequence=user_turns + (1 if advance_sequence else 0),
            token_budget=min(positive_budgets, default=1024),
            prior_activations=prior,
            recursive_scan=any(book.recursive_scan for book in books),
            max_recursion_steps=max(
                (book.max_recursion_steps or 0 for book in books),
                default=0,
            ),
        )

    def record_evaluation(
        self,
        session_id: str,
        response_message: ChatMessage,
        evaluation: LorebookEvaluation,
    ) -> None:
        session = self.history.owned_session(session_id)
        owned_message = self.history.owned_message(response_message.id)
        if (
            owned_message.session_id != session.id
            or owned_message.role != "assistant"
        ):
            raise ChatResourceNotFound("assistant response does not belong to chat")
        trigger_sequence = sum(
            message.role == "user"
            for message in self.history.active_path(
                session.id,
                head_id=owned_message.id,
            )
        )
        for item in evaluation.entries:
            rule = item.rule
            if item.activation_reason == "sticky_active":
                continue
            if rule.sticky <= 0 and rule.cooldown <= 0:
                continue
            exists = self.db.scalar(
                select(LorebookActivationEvent.id).where(
                    LorebookActivationEvent.session_id == session.id,
                    LorebookActivationEvent.response_message_id == owned_message.id,
                    LorebookActivationEvent.entry_id == rule.id,
                )
            )
            if exists is not None:
                continue
            self.db.add(
                LorebookActivationEvent(
                    session_id=session.id,
                    entry_id=rule.id,
                    response_message_id=owned_message.id,
                    entry_revision=rule.revision,
                    trigger_sequence=trigger_sequence,
                    sticky=rule.sticky,
                    cooldown=rule.cooldown,
                )
            )
        self.db.commit()

    def delete_events_for_session(self, session_id: str) -> int:
        self.history.owned_session(session_id)
        deleted = (
            self.db.query(LorebookActivationEvent)
            .filter(LorebookActivationEvent.session_id == session_id)
            .delete(synchronize_session=False)
        )
        self.db.commit()
        return int(deleted)
