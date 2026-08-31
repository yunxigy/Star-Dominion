"""Resolve resources across a framework installation and a content project."""

from __future__ import annotations

from importlib.resources import files
from pathlib import Path


def resolve_craft_dir(project_root: Path) -> Path:
    """Prefer project-specific craft rules, then use OpenWrite defaults."""
    project_craft = Path(project_root).resolve() / "craft"
    if project_craft.is_dir():
        return project_craft
    return Path(str(files("craft")))
