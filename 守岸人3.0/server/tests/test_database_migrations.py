from pathlib import Path
import sys

from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from migrations import run_migrations


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
    assert version == 2
    assert calls == [1]
