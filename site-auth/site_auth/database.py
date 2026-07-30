"""SQLAlchemy database construction for site authentication."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session as OrmSession, sessionmaker


class Base(DeclarativeBase):
    """Declarative base for authentication tables."""


@dataclass(slots=True)
class Database:
    engine: Engine
    sessions: sessionmaker[OrmSession]

    def table_names(self) -> list[str]:
        return inspect(self.engine).get_table_names()

    def dispose(self) -> None:
        self.engine.dispose()


def create_database(path: Path) -> Database:
    """Create an SQLite database and initialize the authentication schema."""

    resolved = path.resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{resolved.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    # Import registers the model metadata without creating a module-level database.
    from . import models  # noqa: F401

    Base.metadata.create_all(engine)
    return Database(
        engine=engine,
        sessions=sessionmaker(bind=engine, expire_on_commit=False),
    )
