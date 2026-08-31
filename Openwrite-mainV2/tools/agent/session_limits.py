"""Shared, environment-tunable budgets for long-lived agent sessions."""

from __future__ import annotations

import os


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


# These are persistence budgets, not the model provider's context-window limit.
# The defaults keep normal requests bounded while preserving enough planning
# history for a genuinely long session.  Full turns are archived separately.
MAX_RECENT_TURNS = _env_int(
    "OPENWRITE_SESSION_RECENT_TURNS", 24, minimum=6, maximum=256
)
MAX_SESSION_BYTES = _env_int(
    "OPENWRITE_SESSION_STATE_BYTES", 131072, minimum=4096, maximum=4 * 1024 * 1024
)
MAX_SUMMARY_BYTES = _env_int(
    "OPENWRITE_SESSION_SUMMARY_BYTES", 16384, minimum=1024, maximum=512 * 1024
)
MAX_TURN_CONTENT_BYTES = _env_int(
    "OPENWRITE_SESSION_TURN_BYTES", 2048, minimum=256, maximum=64 * 1024
)
MAX_STRUCTURAL_TEXT_BYTES = 64
MAX_COMPRESSION_MARKERS = _env_int(
    "OPENWRITE_SESSION_COMPRESSION_MARKERS", 64, minimum=12, maximum=512
)
MAX_WORKING_MEMORY_KEYS = _env_int(
    "OPENWRITE_SESSION_MEMORY_KEYS", 256, minimum=32, maximum=2048
)
