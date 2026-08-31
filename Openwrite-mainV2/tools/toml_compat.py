"""Compatibility wrapper for TOML parsing across supported Python versions."""

from __future__ import annotations

import sys

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib  # type: ignore[import-not-found]

__all__ = ["tomllib"]
