"""FastAPI application factory for the standalone research reports service."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
import httpx

from .collector.github import GitHubClient
from .config import Settings
from .database import create_database
from .routes.admin import router as admin_router
from .routes.public import router as public_router
from .services.collections import CollectionService
from .services.scheduler import (
    CollectionCoordinator,
    build_scheduler,
    ensure_active_issue,
)
from .site_auth import SiteAuthClient


def create_app(
    settings: Settings | None = None,
    *,
    collector=None,
    auth_client=None,
    start_scheduler: bool = True,
    executor: Callable[[Callable[[], None]], object] | None = None,
) -> FastAPI:
    configured = settings or Settings.from_env()
    database = create_database(configured.database_path)
    owned_http = None
    if collector is None:
        owned_http = httpx.Client()
        collector = GitHubClient(http=owned_http, token=configured.github_token)
    collection_service = CollectionService(database=database, collector=collector)
    coordinator_kwargs = {
        "database": database,
        "service": collection_service,
        "timezone": configured.timezone,
    }
    if executor is not None:
        coordinator_kwargs["executor"] = executor
    coordinator = CollectionCoordinator(**coordinator_kwargs)
    scheduler = build_scheduler(coordinator, configured.timezone)
    verifier = auth_client or SiteAuthClient(
        base_url=configured.site_auth_url,
        service_key=configured.site_auth_internal_key,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        ensure_active_issue(database, datetime.now(configured.timezone), configured.timezone)
        if start_scheduler:
            scheduler.start()
        try:
            yield
        finally:
            if scheduler.running:
                scheduler.shutdown(wait=False)
            if owned_http is not None:
                owned_http.close()
            database.dispose()

    app = FastAPI(
        title="Dream Chaser Research Reports",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = configured
    app.state.database = database
    app.state.collection_service = collection_service
    app.state.collection_coordinator = coordinator
    app.state.scheduler = scheduler
    app.state.site_auth_client = verifier
    app.include_router(public_router)
    app.include_router(admin_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "research-reports"}

    return app
