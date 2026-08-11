"""Request-scoped service dependencies."""

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.database.sessions() as session:
        yield session
