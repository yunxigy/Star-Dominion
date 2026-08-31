"""Shared HTTP and error contracts for OpenWrite Studio."""

from __future__ import annotations

import uuid
from http import HTTPStatus
from pathlib import Path
from typing import Any

STATIC_ROOT = Path(__file__).parent / "studio_assets"
REQUIRED_STATIC_ASSETS = (
    "index.html",
    "styles.css",
    "app.js",
    "js/application.js",
    "js/core.js",
    "js/markdown-editor.js",
)
MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
MAX_ASSET_PACKAGE_REQUEST_BYTES = 35 * 1024 * 1024
WRITE_HEADER = "X-OpenWrite-Studio"


def missing_required_static_assets(root: Path = STATIC_ROOT) -> list[str]:
    """Return shell assets whose absence prevents Studio from reporting errors."""
    return [relative for relative in REQUIRED_STATIC_ASSETS if not (root / relative).is_file()]


class StudioError(Exception):
    """Expected Studio failure with a stable machine-readable contract."""

    def __init__(
        self,
        message: str,
        status: int = HTTPStatus.BAD_REQUEST,
        *,
        code: str = "STUDIO_ERROR",
        recoverable: bool = False,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.recoverable = recoverable
        self.details = details or {}


def new_request_id() -> str:
    return f"req_{uuid.uuid4().hex}"


def studio_success_payload(data: Any, request_id: str) -> dict[str, Any]:
    return {
        "ok": True,
        "data": data,
        "error": None,
        "request_id": request_id,
    }


def studio_error_payload(error: StudioError, request_id: str) -> dict[str, Any]:
    """Preserve the legacy error string while exposing the new error contract."""
    return {
        "error": str(error),
        "code": error.code,
        "recoverable": error.recoverable,
        "details": error.details,
        "request_id": request_id,
    }


def internal_error_payload(request_id: str) -> dict[str, Any]:
    return {
        "error": "Studio 内部错误",
        "code": "INTERNAL_ERROR",
        "recoverable": False,
        "details": {},
        "request_id": request_id,
    }
