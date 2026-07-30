import json

import httpx
import pytest

from app.integrations.individual_analysis import IndividualAnalysisClient


@pytest.mark.asyncio
async def test_analysis_request_disables_notifications() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={"success": True, "report": {"summary": {"text": "ok"}}},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://analysis",
    ) as http:
        client = IndividualAnalysisClient(http)
        result = await client.analyze("sh600519")

    assert result["success"] is True
    assert captured["stock_code"] == "600519"
    assert captured["notify"] is False
    assert captured["async_mode"] is False
    assert captured["report_language"] == "zh-CN"
