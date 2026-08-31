"""LLM 错误处理

提供人性化的错误消息，帮助用户快速定位问题。
"""

from __future__ import annotations


class LLMWrappedError(Exception):
    """包装后的 LLM 错误基类"""

    code = "LLM_ERROR"

    def __init__(self, message: str, original_error: str = ""):
        self.message = message
        self.original_error = original_error
        super().__init__(self.message)

    def __str__(self):
        if self.original_error:
            return f"{self.message}\n\n原始错误: {self.original_error}"
        return self.message


class APIError(LLMWrappedError):
    """通用 API 错误"""

    code = "PROVIDER_ERROR"


class AuthenticationError(LLMWrappedError):
    """认证错误 (401/403)"""

    code = "PROVIDER_AUTH_ERROR"


class RateLimitError(LLMWrappedError):
    """限流错误 (429)"""

    code = "PROVIDER_RATE_LIMIT"


class InvalidRequestError(LLMWrappedError):
    """无效请求错误 (400)"""

    code = "PROVIDER_INVALID_REQUEST"


class NetworkError(LLMWrappedError):
    """网络连接错误"""

    code = "PROVIDER_NETWORK_ERROR"


class LLMTimeoutError(LLMWrappedError):
    """Provider request timed out."""

    code = "PROVIDER_TIMEOUT"


class StreamError(LLMWrappedError):
    """流式输出错误"""

    code = "PROVIDER_STREAM_ERROR"


class ContextLengthError(LLMWrappedError):
    """上下文长度超限"""

    code = "PROVIDER_CONTEXT_LENGTH"
