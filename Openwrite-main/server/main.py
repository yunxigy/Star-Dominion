"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

# Load .env file into environment variables
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_path)
    except ImportError:
        # python-dotenv not installed; try manual parsing
        import os
        for line in _env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from server.config import ServerConfig
from server.dependencies import get_config

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# 前端静态文件目录 (npm run build 后的产物)
_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()
    logger.info("OpenWrite server starting, project_root=%s", config.project_root)
    if _STATIC_DIR.exists():
        logger.info("Static files served from %s", _STATIC_DIR)
    yield
    logger.info("OpenWrite server shutting down")


def create_app() -> FastAPI:
    config = get_config()

    app = FastAPI(
        title="OpenWrite",
        version="5.4.0",
        description="OpenWrite 长篇小说创作引擎 Web API",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from server.routers import (
        agents,
        chapters,
        characters,
        export,
        foreshadowing,
        graph,
        history,
        search,
        stats,
        llm_config,
        novels,
        outline,
        status,
        style,
        sync,
        tools,
        truth_files,
        websocket,
        workflow,
        world,
    )

    app.include_router(novels.router, prefix="/api")
    app.include_router(status.router, prefix="/api")
    app.include_router(chapters.router, prefix="/api")
    app.include_router(outline.router, prefix="/api")
    app.include_router(characters.router, prefix="/api")
    app.include_router(world.router, prefix="/api")
    app.include_router(tools.router, prefix="/api")
    app.include_router(truth_files.router, prefix="/api")
    app.include_router(foreshadowing.router, prefix="/api")
    app.include_router(style.router, prefix="/api")
    app.include_router(workflow.router, prefix="/api")
    app.include_router(agents.router, prefix="/api")
    app.include_router(sync.router, prefix="/api")
    app.include_router(export.router, prefix="/api")
    app.include_router(graph.router, prefix="/api")
    app.include_router(history.router, prefix="/api")
    app.include_router(search.router, prefix="/api")
    app.include_router(stats.router, prefix="/api")
    app.include_router(llm_config.router, prefix="/api")
    app.include_router(websocket.router)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    # 托管前端静态文件 (生产模式)
    if _STATIC_DIR.exists():
        # 静态资源 (JS, CSS, 图片等)
        app.mount("/assets", StaticFiles(directory=_STATIC_DIR / "assets"), name="static-assets")

        # SPA 路由: 所有非 API/非静态请求都返回 index.html
        @app.get("/{full_path:path}")
        async def serve_spa(request: Request, full_path: str):
            # 尝试返回具体文件 (如 favicon.ico, robots.txt)
            file_path = _STATIC_DIR / full_path
            if file_path.is_file():
                return FileResponse(file_path)
            # 其他所有路由返回 index.html (SPA 前端路由)
            return FileResponse(_STATIC_DIR / "index.html")
    else:
        @app.get("/")
        async def root():
            return {"name": "OpenWrite", "version": "5.4.0", "note": "Frontend not built. Run: cd frontend && npm run build && cp -r dist ../static"}

    return app


app = create_app()
