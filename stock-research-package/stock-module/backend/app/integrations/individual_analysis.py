"""HTTP client for the isolated individual stock analysis service."""

import httpx

from app.domain.stocks import normalize_symbol


class IndividualAnalysisClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        self._http = http

    async def analyze(
        self,
        symbol: str,
        *,
        report_type: str = "detailed",
        force_refresh: bool = False,
        async_mode: bool = False,
        notify: bool = False,
        report_language: str = "zh-CN",
        model: str | None = None,
        model_route_token: str | None = None,
    ) -> dict:
        payload: dict[str, object] = {
            "stock_code": normalize_symbol(symbol),
            "report_type": report_type,
            "force_refresh": force_refresh,
            "async_mode": async_mode,
            "notify": notify,
            "report_language": report_language,
        }
        if model is not None:
            payload["model"] = model
        if model_route_token is not None:
            payload["model_route_token"] = model_route_token
        response = await self._http.post(
            "/api/v1/analysis/analyze",
            json=payload,
            timeout=120.0,
        )
        response.raise_for_status()
        return response.json()
