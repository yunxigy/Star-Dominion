from __future__ import annotations

import re
import shutil
from pathlib import Path
from uuid import UUID, uuid4

_INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_MULTIPLE_UNDERSCORES = re.compile(r"_+")
_WINDOWS_RESERVED = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def _safe_segment(value: str, *, fallback: str, limit: int) -> str:
    normalized = _INVALID_FILENAME.sub("_", value)
    normalized = _MULTIPLE_UNDERSCORES.sub("_", normalized)
    normalized = normalized.strip(" ._")[:limit].rstrip(" ._")
    if not normalized:
        normalized = fallback
    if normalized.upper() in _WINDOWS_RESERVED:
        normalized = f"_{normalized}"
    return normalized


def safe_download_name(title: str, platform: str, video_id: str, extension: str) -> str:
    safe_title = _safe_segment(title, fallback="video", limit=120)
    safe_platform = _safe_segment(platform, fallback="video", limit=24)
    safe_video_id = _safe_segment(video_id, fallback="unknown", limit=64)
    safe_extension = re.sub(r"[^a-zA-Z0-9]", "", extension).lower() or "mp4"
    return f"{safe_title}-{safe_platform}-{safe_video_id}.{safe_extension}"


class JobFiles:
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()

    def ensure_root(self) -> Path:
        anchor = Path(self.root.anchor).resolve()
        if self.root in {anchor, Path.home().resolve(), Path.cwd().resolve()}:
            raise ValueError("job root must be a dedicated subdirectory")
        self.root.mkdir(parents=True, exist_ok=True)
        return self.root

    def create_job_directory(self) -> tuple[str, Path]:
        self.ensure_root()
        job_id = uuid4().hex
        directory = self.root / job_id
        directory.mkdir(exist_ok=False)
        return job_id, directory

    def cleanup(self, directory: Path) -> None:
        target = directory.resolve()
        if target.parent != self.root or not self._is_uuid_name(target.name):
            raise ValueError("refusing to clean a path outside the job root")
        if target.exists():
            shutil.rmtree(target)

    def cleanup_orphans(self) -> int:
        self.ensure_root()
        removed = 0
        for child in self.root.iterdir():
            if child.is_dir() and self._is_uuid_name(child.name):
                self.cleanup(child)
                removed += 1
        return removed

    @staticmethod
    def _is_uuid_name(value: str) -> bool:
        try:
            UUID(value)
        except ValueError:
            return False
        return True
