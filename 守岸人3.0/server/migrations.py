"""Version bookkeeping around the existing ShouAnRen schema upgrades."""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy import text
from sqlalchemy.engine import Engine

CURRENT_SCHEMA_VERSION = 2


def run_migrations(target_engine: Engine, migrate_legacy_schema: Callable[[], None]) -> None:
    """Run the legacy additive migration once and record its completion."""

    with target_engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS schema_metadata (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    version INTEGER NOT NULL
                )
                """
            )
        )
        connection.execute(
            text("INSERT OR IGNORE INTO schema_metadata (id, version) VALUES (1, 0)")
        )
        current = int(
            connection.execute(
                text("SELECT version FROM schema_metadata WHERE id = 1")
            ).scalar_one()
        )

    if current >= CURRENT_SCHEMA_VERSION:
        return

    migrate_legacy_schema()
    with target_engine.begin() as connection:
        connection.execute(
            text("UPDATE schema_metadata SET version = :version WHERE id = 1"),
            {"version": CURRENT_SCHEMA_VERSION},
        )
