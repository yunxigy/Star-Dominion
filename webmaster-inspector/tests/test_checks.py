from __future__ import annotations

from webmaster_inspector.checks import check_websocket
from webmaster_inspector.policy import ValidatedTarget


def test_websocket_rejects_bad_handshake():
    class FakeSocket:
        def sendall(self, data): self.request = data
        def recv(self, size): return b'HTTP/1.1 400 Bad Request\r\n\r\n'
        def close(self): pass

    import webmaster_inspector.checks as checks
    checks.socket.create_connection = lambda *args, **kwargs: FakeSocket()
    policy = lambda value, **kwargs: ValidatedTarget('ws', 'example.com', 80, '/', '93.184.216.34')
    result = check_websocket('ws://example.com', policy)
    assert result['handshake_ok'] is False
