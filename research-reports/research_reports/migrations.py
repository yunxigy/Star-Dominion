"""Explicit, idempotent SQLite schema migrations for research reports."""

from __future__ import annotations

from sqlalchemy.engine import Connection, Engine

CURRENT_SCHEMA_VERSION = 1


class MigrationError(RuntimeError):
    """Raised when a numbered migration cannot be applied safely."""


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


def _migrate_v1(connection: Connection) -> None:
    tables = {
        row[0]
        for row in connection.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    if "ai_reports" not in tables:
        return
    columns = {
        row[1] for row in connection.exec_driver_sql("PRAGMA table_info(ai_reports)")
    }
    if "events_json" not in columns:
        connection.exec_driver_sql("ALTER TABLE ai_reports ADD COLUMN events_json JSON")
    if "risks_json" not in columns:
        connection.exec_driver_sql("ALTER TABLE ai_reports ADD COLUMN risks_json JSON")


def run_migrations(engine: Engine) -> None:
    """Apply all migrations newer than the recorded schema version."""

    with engine.begin() as connection:
        _ensure_metadata_table(connection)

    migrations = {1: _migrate_v1}
    with engine.connect() as connection:
        current = int(
            connection.exec_driver_sql(
                "SELECT version FROM schema_metadata WHERE id = 1"
            ).scalar_one()
        )

    for target in range(current + 1, CURRENT_SCHEMA_VERSION + 1):
        migration = migrations[target]
        try:
            with engine.begin() as connection:
                migration(connection)
                connection.exec_driver_sql(
                    "UPDATE schema_metadata SET version = ? WHERE id = 1",
                    (target,),
                )
        except Exception as exc:
            raise MigrationError(f"research-reports migration v{target} failed") from exc
