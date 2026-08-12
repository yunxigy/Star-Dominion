"""FastAPI application factory for the standalone research reports service."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
import httpx

from .collector.github import GitHubClient
from .ai_client import SiliconFlowClient
from .config import Settings
from .database import create_database
from .routes.admin import router as admin_router
from .routes.public import router as public_router
from .services.collections import CollectionService
from .services.scheduler import (
    BriefingCoordinator,
    CollectionCoordinator,
    NewsCoordinator,
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
    ai_http = None
    if collector is None:
        owned_http = httpx.Client()
        collector = GitHubClient(http=owned_http, token=configured.github_token)
    ai_client = None
    if configured.ai_api_key:
        ai_http = httpx.Client()
        ai_client = SiliconFlowClient(
            http=ai_http,
            base_url=configured.ai_base_url,
            api_key=configured.ai_api_key,
            model=configured.ai_model,
            timeout=configured.ai_timeout_seconds,
        )
    collection_service = CollectionService(
        database=database,
        collector=collector,
        metadata_enabled=configured.github_token is not None,
    )
    coordinator_kwargs = {
        "database": database,
        "service": collection_service,
        "timezone": configured.timezone,
    }
    if executor is not None:
        coordinator_kwargs["executor"] = executor
    coordinator = CollectionCoordinator(**coordinator_kwargs)
    news_coordinator = NewsCoordinator(database=database, timezone=configured.timezone)
    briefing_coordinator = BriefingCoordinator(database=database, ai_client=ai_client, timezone=configured.timezone)
    scheduler = build_scheduler(coordinator, configured.timezone, news_coordinator=news_coordinator, briefing_coordinator=briefing_coordinator)
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
            if ai_http is not None:
                ai_http.close()
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
    app.state.news_coordinator = news_coordinator
    app.state.briefing_coordinator = briefing_coordinator
    app.state.scheduler = scheduler
    app.state.site_auth_client = verifier
    app.state.ai_client = ai_client
    app.include_router(public_router)
    app.include_router(admin_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "research-reports"}

    return app
