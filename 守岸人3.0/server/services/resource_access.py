"""Centralized ownership checks for private ShouAnRen resources."""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models.character_db import CharacterDB
from ..models.lorebook import Lorebook, LorebookEntry
from ..models.story import StorySession
from ..models.user import User


def _hide_resource(detail: str) -> None:
    """Return 404 for both missing and forbidden private resources."""
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def can_read_character(character: CharacterDB, user: User) -> bool:
    return bool(
        user.role == "admin"
        or character.creator_id == user.id
        or character.user_id == user.id
        or character.is_public
    )


def can_edit_character(character: CharacterDB, user: User) -> bool:
    return bool(
        user.role == "admin"
        or character.creator_id == user.id
        or character.user_id == user.id
    )


def require_readable_character(db: Session, user: User, character_id: str) -> CharacterDB:
    character = db.get(CharacterDB, character_id)
    if character is None or not can_read_character(character, user):
        _hide_resource("Character not found")
    return character


def require_editable_character(db: Session, user: User, character_id: str) -> CharacterDB:
    character = db.get(CharacterDB, character_id)
    if character is None or not can_edit_character(character, user):
        _hide_resource("Character not found")
    return character


def require_owned_story_session(db: Session, user: User, session_id: str) -> StorySession:
    session = db.get(StorySession, session_id)
    if session is None or session.user_id != user.id:
        _hide_resource("Story session not found")
    return session


def _lorebook_character(db: Session, lorebook: Lorebook) -> CharacterDB:
    character = db.get(CharacterDB, lorebook.character_id)
    if character is None:
        _hide_resource("Lorebook not found")
    return character


def require_readable_lorebook(db: Session, user: User, lorebook_id: str) -> Lorebook:
    lorebook = db.get(Lorebook, lorebook_id)
    if lorebook is None or not can_read_character(_lorebook_character(db, lorebook), user):
        _hide_resource("Lorebook not found")
    return lorebook


def require_editable_lorebook(db: Session, user: User, lorebook_id: str) -> Lorebook:
    lorebook = db.get(Lorebook, lorebook_id)
    if lorebook is None or not can_edit_character(_lorebook_character(db, lorebook), user):
        _hide_resource("Lorebook not found")
    return lorebook


def require_editable_lorebook_entry(
    db: Session,
    user: User,
    entry_id: str,
) -> LorebookEntry:
    entry = db.get(LorebookEntry, entry_id)
    if entry is None:
        _hide_resource("Lorebook entry not found")
    require_editable_lorebook(db, user, entry.lorebook_id)
    return entry
