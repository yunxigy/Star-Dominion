from pathlib import Path

from site_auth.database import create_database


def test_site_auth_records_schema_version_and_can_reopen(tmp_path: Path) -> None:
    database_path = tmp_path / "auth.db"
    database = create_database(database_path)
    database.dispose()
    reopened = create_database(database_path)
    try:
        with reopened.engine.connect() as connection:
            version = connection.exec_driver_sql(
                "SELECT version FROM schema_metadata WHERE id = 1"
            ).scalar_one()
        assert version == 0
    finally:
        reopened.dispose()
