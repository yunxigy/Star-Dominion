"""Validation helpers for creator-facing structured asset identifiers."""

from __future__ import annotations

import re
from typing import Any


_ASSET_ID_RE = re.compile(r"[^\W_][\w.-]{0,79}\Z", re.UNICODE)


def is_safe_asset_id(value: Any) -> bool:
    """Return whether a structured asset ID is safe to use as a path segment."""
    asset_id = str(value or "").strip()
    if not asset_id or ".." in asset_id:
        return False
    if any(ord(char) < 32 or char in {"/", "\\"} for char in asset_id):
        return False
    return bool(_ASSET_ID_RE.fullmatch(asset_id))
