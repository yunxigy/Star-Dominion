"""Request-scoped configuration and execution against a pinned DSA checkout."""

import copy
from dataclasses import dataclass
import importlib
from pathlib import Path
import sys
from typing import Any
from uuid import uuid4


class DSAInstallationError(RuntimeError):
    pass


class AnalysisRuntimeError(RuntimeError):
    pass


@dataclass(frozen=True)
class DSASymbols:
    pipeline_class: type
    report_type_class: type
    analysis_service_class: type


def validate_source_root(source_root: str | Path) -> Path:
    resolved = Path(source_root).resolve()
    marker = resolved / "src" / "core" / "pipeline.py"
    if not marker.is_file():
        raise DSAInstallationError(
            "DSA_SOURCE_ROOT must point to a daily_stock_analysis checkout"
        )
    return resolved


def load_dsa_symbols(source_root: str | Path) -> tuple[Any, DSASymbols]:
    resolved = validate_source_root(source_root)
    root_text = str(resolved)
    if root_text not in sys.path:
        sys.path.insert(0, root_text)
    try:
        config_module = importlib.import_module("src.config")
        pipeline_module = importlib.import_module("src.core.pipeline")
        enum_module = importlib.import_module("src.enums")
        service_module = importlib.import_module("src.services.analysis_service")
        base_config = config_module.get_config()
    except Exception as exc:
        raise DSAInstallationError("daily_stock_analysis could not be loaded") from exc
    return base_config, DSASymbols(
        pipeline_class=pipeline_module.StockAnalysisPipeline,
        report_type_class=enum_module.ReportType,
        analysis_service_class=service_module.AnalysisService,
    )


def build_request_config(
    base_config: Any,
    model: str,
    route_token: str,
    gateway_url: str,
    service_token: str,
) -> Any:
    """Return an isolated shallow config copy with exactly one internal LLM route."""
    scoped = copy.copy(base_config)
    route_name = f"sd-route/{model}"
    scoped.litellm_model = route_name
    scoped.llm_models_source = "llm_channels"
    scoped.llm_model_list = [
        {
            "model_name": route_name,
            "litellm_params": {
                "model": f"openai/{model}",
                "api_base": gateway_url.rstrip("/"),
                "api_key": service_token,
                "extra_headers": {
                    "X-Stock-Service-Token": service_token,
                    "X-Stock-Model-Route": route_token,
                },
            },
        }
    ]
    scoped.litellm_fallback_models = []
    return scoped


class RequestScopedAnalysisRuntime:
    def __init__(
        self,
        *,
        base_config: Any,
        symbols: DSASymbols,
        gateway_url: str,
        service_token: str,
    ) -> None:
        if not gateway_url.strip() or not service_token.strip():
            raise ValueError("gateway URL and service token are required")
        self._base_config = base_config
        self._symbols = symbols
        self._gateway_url = gateway_url
        self._service_token = service_token

    def analyze(
        self,
        *,
        stock_code: str,
        model: str,
        route_token: str,
        report_type: str = "detailed",
        force_refresh: bool = False,
        report_language: str = "zh",
        skills: list[str] | None = None,
        analysis_phase: str = "auto",
        portfolio_context: dict[str, Any] | None = None,
        **_: object,
    ) -> dict:
        scoped = build_request_config(
            self._base_config,
            model,
            route_token,
            self._gateway_url,
            self._service_token,
        )
        scoped.report_language = report_language
        query_id = uuid4().hex
        trace_id = uuid4().hex
        pipeline = self._symbols.pipeline_class(
            config=scoped,
            query_id=query_id,
            trace_id=trace_id,
            query_source="stock-hub",
            progress_callback=None,
            analysis_skills=skills,
            analysis_phase=analysis_phase,
            portfolio_context=portfolio_context,
        )
        normalized_type = self._symbols.report_type_class.from_str(report_type)
        result = pipeline.process_single_stock(
            code=stock_code,
            skip_analysis=False,
            single_stock_notify=False,
            report_type=normalized_type,
        )
        if result is None or not getattr(result, "success", True):
            raise AnalysisRuntimeError("daily_stock_analysis returned no successful result")

        service = self._symbols.analysis_service_class.__new__(
            self._symbols.analysis_service_class
        )
        response = service._build_analysis_response(
            result,
            query_id,
            report_type=normalized_type.value,
        )
        return {"success": True, **response}

