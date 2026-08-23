from __future__ import annotations

import importlib.util
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .config import VideoSettings

CookieStatus = Literal["configured", "missing", "invalid"]


@dataclass(frozen=True)
class DependencyStatus:
    yt_dlp: bool
    ffmpeg: bool
    douyin_cookie: CookieStatus


class DependencyProbe:
    def __init__(self, settings: VideoSettings) -> None:
        self._settings = settings

    def status(self) -> DependencyStatus:
        return DependencyStatus(
            yt_dlp=importlib.util.find_spec("yt_dlp") is not None,
            ffmpeg=self._ffmpeg_available(),
            douyin_cookie=self._cookie_status(self._settings.douyin_cookie_file),
        )

    def _ffmpeg_available(self) -> bool:
        executable = shutil.which(self._settings.ffmpeg_bin)
        if executable is None:
            return False
        try:
            completed = subprocess.run(
                [executable, "-version"],
                capture_output=True,
                check=False,
                timeout=3,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return completed.returncode == 0

    @staticmethod
    def _cookie_status(cookie_file: Path | None) -> CookieStatus:
        if cookie_file is None:
            return "missing"
        try:
            if not cookie_file.is_file() or cookie_file.stat().st_size == 0:
                return "invalid"
            prefix = cookie_file.read_text(encoding="utf-8", errors="ignore")[:2048]
        except OSError:
            return "invalid"
        if "Netscape HTTP Cookie File" not in prefix:
            return "invalid"
        return "configured"
