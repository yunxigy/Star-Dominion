from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from collections.abc import Callable

import anyio
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from .checks import check_dns, check_http, check_ssl, check_websocket
from .models import DnsCheckRequest, DnsResponse, HttpCheckRequest, InspectionResponse, SslCheckRequest, SslResponse, WebSocketCheckRequest, WebSocketResponse
from .policy import TargetBlockedError

app = FastAPI(title="Webmaster Inspector", version="0.1.0", docs_url=None, redoc_url=None)


class SlidingWindowLimiter:
    def __init__(self, limit: int = 30, window_seconds: float = 60.0, max_keys: int = 10_000):
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> tuple[bool, int]:
        now = time.monotonic()
        events = self._events[key]
        while events and events[0] <= now - self.window_seconds:
            events.popleft()
        if len(self._events) > self.max_keys:
            for stale_key in sorted(self._events, key=lambda item: self._events[item][-1] if self._events[item] else 0)[: len(self._events) - self.max_keys]:
                self._events.pop(stale_key, None)
        if len(events) >= self.limit:
            retry = max(1, int(self.window_seconds - (now - events[0])))
            return False, retry
        events.append(now)
        return True, 0


limiter = SlidingWindowLimiter()


def get_http_checker() -> Callable[[str], dict]: return check_http
def get_dns_checker() -> Callable[[str], dict]: return check_dns
def get_ssl_checker() -> Callable[[str], dict]: return check_ssl
def get_websocket_checker() -> Callable[[str], dict]: return check_websocket


def _error_response(code: str, message: str, status: int, retry_after: int | None = None) -> JSONResponse:
    response = JSONResponse(status_code=status, content={"code": code, "message": message})
    response.headers["Cache-Control"] = "no-store"
    if retry_after is not None:
        response.headers["Retry-After"] = str(retry_after)
    return response


async def _run(request: Request, checker: Callable[[str], dict], target: str):
    client_host = request.client.host if request.client else "unknown"
    allowed, retry_after = limiter.allow(client_host)
    if not allowed:
        return _error_response("RATE_LIMITED", "请求过于频繁，请稍后再试", 429, retry_after)
    try:
        result = await anyio.to_thread.run_sync(checker, target)
        response = JSONResponse(status_code=200, content=result)
        response.headers["Cache-Control"] = "no-store"
        return response
    except TargetBlockedError:
        return _error_response("TARGET_BLOCKED", "目标地址被安全策略拦截", 400)
    except (TimeoutError, asyncio.TimeoutError):
        return _error_response("TARGET_TIMEOUT", "目标响应超时，请稍后重试", 504)
    except (ConnectionError, OSError):
        return _error_response("TARGET_UNAVAILABLE", "目标暂时无法连接", 502)
    except Exception:
        return _error_response("TARGET_UNAVAILABLE", "目标检测失败，请稍后重试", 502)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/v1/http", response_model=InspectionResponse)
async def http_endpoint(payload: HttpCheckRequest, request: Request, checker=Depends(get_http_checker)):
    return await _run(request, checker, str(payload.url))


@app.post("/api/v1/dns", response_model=DnsResponse)
async def dns_endpoint(payload: DnsCheckRequest, request: Request, checker=Depends(get_dns_checker)):
    return await _run(request, checker, payload.hostname)


@app.post("/api/v1/ssl", response_model=SslResponse)
async def ssl_endpoint(payload: SslCheckRequest, request: Request, checker=Depends(get_ssl_checker)):
    return await _run(request, checker, payload.hostname)


@app.post("/api/v1/websocket", response_model=WebSocketResponse)
async def websocket_endpoint(payload: WebSocketCheckRequest, request: Request, checker=Depends(get_websocket_checker)):
    return await _run(request, checker, payload.url)
