from __future__ import annotations

from fastapi.testclient import TestClient

from webmaster_inspector.app import app, get_http_checker
from webmaster_inspector.policy import TargetBlockedError


client = TestClient(app)


def test_health_and_strict_payloads():
    assert client.get('/health').json() == {'status': 'ok'}
    response = client.post('/api/v1/http', json={'url': 'https://example.com', 'unexpected': True})
    assert response.status_code == 422


def test_policy_error_contract():
    def blocked(_target): raise TargetBlockedError()
    app.dependency_overrides[get_http_checker] = lambda: blocked
    try:
        response = client.post('/api/v1/http', json={'url': 'https://example.com'})
        assert response.status_code == 400
        assert response.json() == {'code': 'TARGET_BLOCKED', 'message': '目标地址被安全策略拦截'}
        assert response.headers['cache-control'] == 'no-store'
    finally:
        app.dependency_overrides.clear()
