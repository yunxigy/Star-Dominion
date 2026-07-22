"""Private FastAPI surface for one request-scoped DSA stock analysis."""

from contextlib import asynccontextmanager
import os
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from analysis_service.runtime import (
    AnalysisRuntimeError,
    RequestScopedAnalysisRuntime,
    load_dsa_symbols,
    validate_source_root,
)


class AnalysisRequest(BaseModel):
    stock_code: str
    model: str = Field(min_length=1, max_length=300)
    model_route_token: str = Field(min_length=16, max_length=4096)
    report_type: Literal["detailed", "brief"] = "detailed"
    force_refresh: bool = False
    async_mode: Literal[False] = False
    notify: Literal[False] = False
    report_language: Literal["zh"] = "zh"
    skills: list[str] | None = None
    analysis_phase: Literal["auto", "premarket", "intraday", "postmarket"] = "auto"
    portfolio_context: dict[str, Any] | None = None

    @field_validator("stock_code")
    @classmethod
    def normalize_main_board_symbol(cls, value: str) -> str:
        import re

        symbol = re.sub(r"^(sh|sz)", "", value.strip().lower())
        if not re.fullmatch(r"\d{6}", symbol) or not symbol.startswith(
            ("600", "601", "603", "605", "000", "001", "002")
        ):
            raise ValueError("only A-share main-board symbols are supported")
        return symbol

    @field_validator("model")
    @classmethod
    def strip_model(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("model cannot be blank")
        return value


def create_app(
    *,
    runtime: RequestScopedAnalysisRuntime | Any | None = None,
    source_root: str | Path | None = None,
) -> FastAPI:
    configured_root: Path | None = None
    state: dict[str, Any] = {"runtime": runtime}
    if runtime is None:
        configured_root = validate_source_root(source_root or _default_source_root())

    def require_runtime() -> RequestScopedAnalysisRuntime:
        if state["runtime"] is None:
            base_config, symbols = load_dsa_symbols(configured_root)
            state["runtime"] = RequestScopedAnalysisRuntime(
                base_config=base_config,
                symbols=symbols,
                gateway_url=os.environ.get(
                    "STOCK_GATEWAY_INTERNAL_URL", "http://127.0.0.1:8004/v1"
                ),
                service_token=os.environ.get("STOCK_GATEWAY_SERVICE_TOKEN", ""),
            )
        return state["runtime"]

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if runtime is None:
            require_runtime()
        yield

    production = os.environ.get("STOCK_ENV", "development").lower() == "production"
    application = FastAPI(
        title="Star Dominion Individual Analysis Adapter",
        version="0.1.0",
        docs_url=None if production else "/docs",
        redoc_url=None,
        openapi_url=None if production else "/openapi.json",
        lifespan=lifespan,
    )

    @application.get("/api/v1/health")
    def health() -> dict:
        return {"service": "analysis-adapter", "status": "ok"}

    @application.post("/api/v1/analysis/analyze")
    def analyze(request: AnalysisRequest) -> dict:
        try:
            return require_runtime().analyze(
                stock_code=request.stock_code,
                model=request.model,
                route_token=request.model_route_token,
                report_type=request.report_type,
                force_refresh=request.force_refresh,
                report_language=request.report_language,
                skills=request.skills,
                analysis_phase=request.analysis_phase,
                portfolio_context=request.portfolio_context,
                async_mode=False,
                notify=False,
            )
        except AnalysisRuntimeError as exc:
            raise HTTPException(
                status_code=502,
                detail={"code": "DSA_ANALYSIS_FAILED", "message": "个股分析执行失败"},
            ) from exc

    return application


def _default_source_root() -> Path:
    explicit = os.environ.get("DSA_SOURCE_ROOT", "").strip()
    if explicit:
        return Path(explicit)
    return Path(__file__).resolve().parents[3] / "upstreams" / "daily_stock_analysis"


app = create_app()

