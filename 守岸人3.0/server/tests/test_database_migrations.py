from pathlib import Path
import sys

from sqlalchemy import create_engine, inspect, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from migrations import run_migrations
from server.database import migrate_lorebook_engine


def test_schema_migrations_record_version_and_run_once(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{(tmp_path / 'shouanren.db').as_posix()}")
    calls: list[int] = []

    def migrate_legacy_schema() -> None:
        calls.append(1)

    run_migrations(engine, migrate_legacy_schema)
    run_migrations(engine, migrate_legacy_schema)
    with engine.connect() as connection:
        version = connection.execute(
            text("SELECT version FROM schema_metadata WHERE id = 1")
        ).scalar_one()
    assert version == 3
    assert calls == [1]


def test_lorebook_engine_migration_is_additive(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE lorebooks ("
                "id VARCHAR PRIMARY KEY, character_id VARCHAR NOT NULL, "
                "name VARCHAR NOT NULL)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE lorebook_entries ("
                "id VARCHAR PRIMARY KEY, lorebook_id VARCHAR NOT NULL, "
                "keyword VARCHAR NOT NULL, content TEXT NOT NULL)"
            )
        )

    migrate_lorebook_engine(engine)

    inspector = inspect(engine)
    book_columns = {item["name"] for item in inspector.get_columns("lorebooks")}
    entry_columns = {
        item["name"] for item in inspector.get_columns("lorebook_entries")
    }
    assert {
        "token_budget",
        "recursive_scan",
        "max_recursion_steps",
        "is_character_default",
    } <= book_columns
    assert {
        "sticky",
        "delay",
        "prevent_recursion",
        "recursion_only",
        "group_prioritized",
        "revision",
    } <= entry_columns
    assert {
        "lorebook_bindings",
        "lorebook_activation_events",
    } <= set(inspector.get_table_names())
