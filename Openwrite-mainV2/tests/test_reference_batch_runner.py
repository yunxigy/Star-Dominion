from __future__ import annotations

import json

import tools.reference_batch_runner as runner


def test_v4_flash_reference_requests_use_non_thinking_mode(monkeypatch):
    captured: dict[str, object] = {}

    profile = {
        "api_key": "test-key",
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "deepseek-ai/DeepSeek-V4-Flash",
    }
    monkeypatch.setattr(
        runner.ModelProfileStore,
        "resolve",
        lambda self, route: profile,
    )

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

        def read(self):
            return (
                b'{"choices":[{"message":{"content":"{\\"summary\\":'
                b'\\"ok\\",\\"findings\\":[]}"}}]}'
            )

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(runner, "urlopen", fake_urlopen)

    result = runner._request_json("测试片段", repair=False)

    body = captured["body"]
    assert isinstance(body, dict)
    assert body["enable_thinking"] is False
    assert "reasoning_effort" not in body
    assert result["summary"] == "ok"
