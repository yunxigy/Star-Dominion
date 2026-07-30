from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from analysis_service.main import create_app
from analysis_service.runtime import (
    DSAInstallationError,
    DSASymbols,
    RequestScopedAnalysisRuntime,
    build_request_config,
    validate_source_root,
)


class FakeReportType:
    @classmethod
    def from_str(cls, value: str) -> SimpleNamespace:
        return SimpleNamespace(value="full" if value == "detailed" else value)


class FakeResult:
    success = True


class FakePipeline:
    calls: list[dict] = []

    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs

    def process_single_stock(self, **kwargs: object) -> FakeResult:
        self.calls.append({"init": self.kwargs, "process": kwargs})
        return FakeResult()


class FakeAnalysisService:
    def _build_analysis_response(
        self, result: object, query_id: str, report_type: str
    ) -> dict:
        return {
            "query_id": query_id,
            "report": {"meta": {"report_type": report_type}},
        }


def _base_config() -> SimpleNamespace:
    return SimpleNamespace(
        litellm_model="global",
        llm_models_source="legacy_env",
        llm_model_list=[],
        litellm_fallback_models=["old"],
        report_language="en",
    )


def _runtime() -> RequestScopedAnalysisRuntime:
    FakePipeline.calls = []
    return RequestScopedAnalysisRuntime(
        base_config=_base_config(),
        symbols=DSASymbols(
            pipeline_class=FakePipeline,
            report_type_class=FakeReportType,
            analysis_service_class=FakeAnalysisService,
        ),
        gateway_url="http://127.0.0.1:8004/v1",
        service_token="service-token",
    )


def test_request_config_does_not_mutate_global_config() -> None:
    base = _base_config()
    scoped = build_request_config(
        base, "m1", "route-1", "http://127.0.0.1:8004/v1", "service-token"
    )

    assert base.litellm_model == "global"
    assert base.llm_model_list == []
    assert scoped.litellm_model == "sd-route/m1"
    assert scoped.llm_models_source == "llm_channels"
    assert scoped.litellm_fallback_models == []
    params = scoped.llm_model_list[0]["litellm_params"]
    assert params["model"] == "openai/m1"
    assert params["api_base"] == "http://127.0.0.1:8004/v1"
    assert params["api_key"] == "service-token"
    assert params["extra_headers"] == {
        "X-Stock-Service-Token": "service-token",
        "X-Stock-Model-Route": "route-1",
    }


def test_concurrent_requests_keep_models_and_tokens_isolated() -> None:
    runtime = _runtime()
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                runtime.analyze,
                stock_code="600519",
                model=model,
                route_token=route,
                report_type="detailed",
                report_language="zh",
            )
            for model, route in (("m1", "route-1"), ("m2", "route-2"))
        ]
        results = [future.result() for future in futures]

    assert all(result["success"] is True for result in results)
    routed = {
        call["init"]["config"].litellm_model:
        call["init"]["config"].llm_model_list[0]["litellm_params"]["extra_headers"]["X-Stock-Model-Route"]
        for call in FakePipeline.calls
    }
    assert routed == {"sd-route/m1": "route-1", "sd-route/m2": "route-2"}
    assert all(call["init"]["query_source"] == "stock-hub" for call in FakePipeline.calls)
    assert all(call["init"]["progress_callback"] is None for call in FakePipeline.calls)
    assert all(call["process"]["single_stock_notify"] is False for call in FakePipeline.calls)


def test_source_root_validation_requires_pinned_pipeline(tmp_path: Path) -> None:
    with pytest.raises(DSAInstallationError):
        validate_source_root(tmp_path)
    pipeline = tmp_path / "src" / "core" / "pipeline.py"
    pipeline.parent.mkdir(parents=True)
    pipeline.write_text("# marker", encoding="utf-8")
    assert validate_source_root(tmp_path) == tmp_path.resolve()


class ApiRuntime:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def analyze(self, **request: object) -> dict:
        self.calls.append(request)
        return {"success": True, "query_id": "q1", "report": {"summary": "ok"}}


@pytest.mark.asyncio
async def test_internal_api_accepts_one_non_notifying_main_board_request() -> None:
    runtime = ApiRuntime()
    app = create_app(runtime=runtime)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/analysis/analyze",
            json={
                "stock_code": "sh600519",
                "model": "m1",
                "model_route_token": "route-token-long-enough",
                "report_type": "detailed",
                "async_mode": False,
                "notify": False,
                "report_language": "zh",
            },
        )

    assert response.status_code == 200
    assert response.json()["report"] == {"summary": "ok"}
    assert runtime.calls[0]["stock_code"] == "600519"
    assert runtime.calls[0]["model"] == "m1"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "override",
    [
        {"stock_code": "300750"},
        {"model": ""},
        {"model_route_token": ""},
        {"notify": True},
        {"async_mode": True},
    ],
)
async def test_internal_api_rejects_unsupported_requests(override: dict) -> None:
    payload = {
        "stock_code": "600519",
        "model": "m1",
        "model_route_token": "route-token-long-enough",
        "report_type": "detailed",
        "async_mode": False,
        "notify": False,
        "report_language": "zh",
    }
    payload.update(override)
    app = create_app(runtime=ApiRuntime())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/analysis/analyze", json=payload)

    assert response.status_code == 422
