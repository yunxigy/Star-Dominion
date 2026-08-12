"""Schema bookkeeping for the standalone site-auth database."""

from __future__ import annotations

from sqlalchemy.engine import Connection, Engine

CURRENT_SCHEMA_VERSION = 0


def _ensure_metadata_table(connection: Connection) -> None:
    connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS schema_metadata (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            version INTEGER NOT NULL
        )
        """
    )
    connection.exec_driver_sql(
        "INSERT OR IGNORE INTO schema_metadata (id, version) VALUES (1, 0)"
    )


def run_migrations(engine: Engine) -> None:
    """Create migration metadata; version 0 has no additive steps yet."""

    with engine.begin() as connection:
        _ensure_metadata_table(connection)
