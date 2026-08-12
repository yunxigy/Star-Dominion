import httpx

from research_reports.ai_client import SiliconFlowClient


def test_deepseek_client_posts_openai_compatible_payload() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "{\"title\":\"AI早报\"}"}}]})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        client = SiliconFlowClient(http=http, base_url="https://api.siliconflow.cn/v1", api_key="secret", model="deepseek-v4-flash")
        result = client.generate(system="只基于资料", user="资料")
    finally:
        http.close()

    assert result.text
    assert requests[0].url.path == "/v1/chat/completions"
    assert requests[0].headers["Authorization"] == "Bearer secret"


def test_client_does_not_expose_api_key_in_errors() -> None:
    http = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(500)))
    try:
        client = SiliconFlowClient(http=http, base_url="https://api.siliconflow.cn/v1", api_key="secret", model="deepseek-v4-flash")
        try:
            client.generate(system="system", user="user")
        except RuntimeError as exc:
            assert "secret" not in str(exc)
    finally:
        http.close()


def test_client_lists_models_from_openai_compatible_catalog() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "deepseek-v4-flash"}, {"id": "other-model"}]})

    http = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        client = SiliconFlowClient(http=http, base_url="https://api.siliconflow.cn/v1", api_key="secret", model="deepseek-v4-flash")
        models = client.list_models()
    finally:
        http.close()

    assert models == ["deepseek-v4-flash", "other-model"]
    assert requests[0].url.path == "/v1/models"
    assert requests[0].headers["Authorization"] == "Bearer secret"
