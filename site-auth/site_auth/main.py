"""FastAPI application factory for unified site authentication."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .database import create_database
from .internal import router as internal_router
from .routes import router as session_router
from .session_service import SessionService


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings or Settings.from_env()
    database = create_database(configured.database_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        database.dispose()

    app = FastAPI(
        title="Star Dominion Site Authentication",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = configured
    app.state.database = database
    app.state.session_service = SessionService()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(configured.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )
    app.include_router(session_router)
    app.include_router(internal_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "site-auth"}

    return app

