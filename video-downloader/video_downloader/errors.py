from __future__ import annotations


class ServiceError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        http_status: int,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.retryable = retryable
