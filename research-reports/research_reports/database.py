"""SQLAlchemy database boundary."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .models import Base


@dataclass(slots=True)
class Database:
    engine: Engine
    sessions: sessionmaker[Session]

    def dispose(self) -> None:
        self.engine.dispose()


def create_database(path: Path) -> Database:
    resolved = path.resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{resolved.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return Database(engine=engine, sessions=sessionmaker(engine, expire_on_commit=False))
