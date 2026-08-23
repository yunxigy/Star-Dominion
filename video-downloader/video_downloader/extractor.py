from __future__ import annotations

import shutil
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

from .config import VideoSettings
from .errors import ServiceError
from .files import safe_download_name
from .format_policy import FormatPolicy, FormatSelection
from .models import VideoInfo
from .url_policy import ResolvedVideoUrl


class YoutubeDlContext(Protocol):
    def __enter__(self) -> "YoutubeDlContext":
        raise NotImplementedError

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        raise NotImplementedError

    def extract_info(self, url: str, download: bool) -> Any:
        raise NotImplementedError


YdlFactory = Callable[[dict[str, Any]], YoutubeDlContext]


def _default_ydl_factory(options: dict[str, Any]) -> YoutubeDlContext:
    from yt_dlp import YoutubeDL

    return YoutubeDL(options)


@dataclass(frozen=True)
class ExtractedVideo:
    normalized_url: str
    video: VideoInfo
    format_map: dict[str, FormatSelection]


@dataclass(frozen=True)
class DownloadSpec:
    target: ResolvedVideoUrl
    video_id: str
    title: str
    selection: FormatSelection
    directory: Path
    cancel_event: threading.Event


class DownloadHooks(Protocol):
    def extracting(self) -> None:
        raise NotImplementedError

    def downloading(
        self,
        downloaded_bytes: int,
        total_bytes: int | None,
        speed_bytes_per_second: float | None,
    ) -> None:
        raise NotImplementedError

    def merging(self) -> None:
        raise NotImplementedError

    def completed(self, output_path: Path) -> None:
        raise NotImplementedError


class DownloadCancelled(Exception):
    """Raised from yt-dlp hooks when the owning job has been cancelled."""


class YtDlpExtractor:
    def __init__(
        self,
        settings: VideoSettings,
        ydl_factory: YdlFactory | None = None,
        ffmpeg_available: Callable[[], bool] | None = None,
    ) -> None:
        self._settings = settings
        self._ydl_factory = ydl_factory or _default_ydl_factory
        self._format_policy = FormatPolicy(settings.max_file_bytes)
        self._ffmpeg_available = ffmpeg_available or (
            lambda: shutil.which(self._settings.ffmpeg_bin) is not None
        )

    def extract(self, target: ResolvedVideoUrl) -> ExtractedVideo:
        options: dict[str, Any] = {
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "allowed_extractors": ["Douyin", "BiliBili"],
            "socket_timeout": 15,
            "retries": 1,
            "extractor_retries": 1,
        }
        cookie_file = self._valid_cookie_file(target.platform)
        if cookie_file is not None:
            options["cookiefile"] = str(cookie_file)

        try:
            with self._ydl_factory(options) as ydl:
                result = ydl.extract_info(target.url, download=False)
        except Exception as exc:
            if self._is_yt_dlp_error(exc):
                raise self._map_download_error(exc, target.platform) from exc
            raise

        if not isinstance(result, dict):
            raise ServiceError(
                "EXTRACTOR_TEMPORARILY_UNAVAILABLE",
                "平台暂未返回可用的视频信息，请稍后重试。",
                502,
                retryable=True,
            )
        if result.get("_type") == "playlist" or isinstance(result.get("entries"), (list, tuple)):
            raise ServiceError(
                "PLAYLIST_NOT_SUPPORTED",
                "第一版只支持单个视频，不支持合集、播放列表或多 P。",
                422,
            )

        self._validate_extractor(result, target)
        duration = self._duration(result.get("duration"))
        if duration > self._settings.max_duration_seconds:
            raise ServiceError(
                "DURATION_LIMIT",
                "视频时长超过当前服务限制。",
                413,
            )

        raw_formats = result.get("formats")
        formats = [item for item in raw_formats if isinstance(item, dict)] if isinstance(raw_formats, list) else []
        selections = self._format_policy.build(target.platform, formats)
        if not selections:
            if formats:
                raise ServiceError(
                    "FILE_SIZE_LIMIT",
                    "该视频可用清晰度均超过当前文件大小限制。",
                    413,
                )
            raise ServiceError(
                "PRIVATE_OR_UNAVAILABLE",
                "视频不可用、需要登录或没有可下载的视频源。",
                422,
            )

        video_id = self._text(result.get("id")) or "unknown"
        title = self._text(result.get("title")) or "未命名视频"
        author = (
            self._text(result.get("uploader"))
            or self._text(result.get("channel"))
            or self._text(result.get("creator"))
            or None
        )
        thumbnail = self._safe_thumbnail(result.get("thumbnail"))
        public_qualities = [selection.public for selection in selections]
        format_map = {selection.public.id: selection for selection in selections}
        return ExtractedVideo(
            normalized_url=target.url,
            video=VideoInfo(
                platform=target.platform,
                id=video_id,
                title=title,
                author=author,
                thumbnail_url=thumbnail,
                duration_seconds=duration,
                qualities=public_qualities,
            ),
            format_map=format_map,
        )

    def download(self, spec: DownloadSpec, hooks: DownloadHooks) -> Path:
        if spec.cancel_event.is_set():
            raise DownloadCancelled()
        if spec.selection.public.requires_merge and not self._ffmpeg_available():
            raise ServiceError(
                "DEPENDENCY_UNAVAILABLE",
                "该清晰度需要 FFmpeg 合并音视频，但服务器当前不可用。",
                503,
                retryable=True,
            )

        directory = spec.directory.resolve()
        directory.mkdir(parents=True, exist_ok=True)

        def progress_hook(payload: dict[str, Any]) -> None:
            if spec.cancel_event.is_set():
                raise DownloadCancelled()
            if payload.get("status") != "downloading":
                return
            downloaded = self._non_negative_int(payload.get("downloaded_bytes"))
            total = self._optional_positive_int(
                payload.get("total_bytes") or payload.get("total_bytes_estimate")
            )
            speed = self._optional_positive_float(payload.get("speed"))
            if downloaded > self._settings.max_file_bytes:
                spec.cancel_event.set()
                raise ServiceError(
                    "FILE_SIZE_LIMIT",
                    "视频实际下载大小超过当前服务限制。",
                    413,
                )
            hooks.downloading(downloaded, total, speed)

        def postprocessor_hook(payload: dict[str, Any]) -> None:
            if spec.cancel_event.is_set():
                raise DownloadCancelled()
            processor = self._text(payload.get("postprocessor")).lower()
            if payload.get("status") == "started" and "ffmpeg" in processor:
                hooks.merging()

        options: dict[str, Any] = {
            "format": spec.selection.selector,
            "outtmpl": str(directory / "media.%(ext)s"),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "allowed_extractors": ["Douyin", "BiliBili"],
            "overwrites": False,
            "continuedl": False,
            "max_filesize": self._settings.max_file_bytes,
            "socket_timeout": 30,
            "retries": 1,
            "fragment_retries": 1,
            "progress_hooks": [progress_hook],
            "postprocessor_hooks": [postprocessor_hook],
        }
        if spec.selection.merge_extension is not None:
            options["merge_output_format"] = spec.selection.merge_extension
        if self._settings.ffmpeg_bin != "ffmpeg":
            options["ffmpeg_location"] = self._settings.ffmpeg_bin
        cookie_file = self._valid_cookie_file(spec.target.platform)
        if cookie_file is not None:
            options["cookiefile"] = str(cookie_file)

        hooks.extracting()
        try:
            with self._ydl_factory(options) as ydl:
                result = ydl.extract_info(spec.target.url, download=True)
        except (DownloadCancelled, ServiceError):
            raise
        except Exception as exc:
            if self._is_yt_dlp_error(exc):
                message = str(exc).lower()
                if spec.selection.public.requires_merge and any(
                    marker in message for marker in ("ffmpeg", "postprocess", "merger", "merge")
                ):
                    raise ServiceError(
                        "MERGE_FAILED",
                        "FFmpeg 合并音视频失败，请稍后重试。",
                        500,
                        retryable=True,
                    ) from exc
                raise self._map_download_error(exc, spec.target.platform) from exc
            raise

        if spec.cancel_event.is_set():
            raise DownloadCancelled()
        output = self._locate_output(directory, result)
        if output.stat().st_size > self._settings.max_file_bytes:
            raise ServiceError(
                "FILE_SIZE_LIMIT",
                "视频实际文件大小超过当前服务限制。",
                413,
            )
        extension = output.suffix.lstrip(".") or spec.selection.public.extension
        final_path = directory / safe_download_name(
            spec.title,
            spec.target.platform,
            spec.video_id,
            extension,
        )
        if output != final_path:
            output.replace(final_path)
        hooks.completed(final_path)
        return final_path

    @staticmethod
    def _locate_output(directory: Path, result: object) -> Path:
        candidates: list[Path] = []
        if isinstance(result, dict):
            requested = result.get("requested_downloads")
            if isinstance(requested, list):
                for item in requested:
                    if isinstance(item, dict) and isinstance(item.get("filepath"), str):
                        candidates.append(Path(item["filepath"]))
            for key in ("filepath", "_filename"):
                if isinstance(result.get(key), str):
                    candidates.append(Path(result[key]))
        candidates.extend(
            path
            for path in directory.iterdir()
            if path.is_file() and not path.name.endswith((".part", ".ytdl"))
        )

        for candidate in reversed(candidates):
            resolved = candidate.expanduser().resolve()
            if resolved.parent == directory and resolved.is_file():
                return resolved
        raise ServiceError(
            "EXTRACTOR_TEMPORARILY_UNAVAILABLE",
            "视频下载完成但未找到安全的输出文件。",
            502,
            retryable=True,
        )

    def _valid_cookie_file(self, platform: str) -> Path | None:
        cookie_file = self._settings.douyin_cookie_file
        if platform != "douyin" or cookie_file is None:
            return None
        try:
            return cookie_file if cookie_file.is_file() and cookie_file.stat().st_size > 0 else None
        except OSError:
            return None

    @staticmethod
    def _validate_extractor(result: dict[str, Any], target: ResolvedVideoUrl) -> None:
        extractor_key = YtDlpExtractor._text(result.get("extractor_key")).lower()
        expected = "douyin" if target.platform == "douyin" else "bilibili"
        if extractor_key != expected:
            raise ServiceError("INVALID_URL", "视频平台识别结果不一致。", 400)

        webpage_url = YtDlpExtractor._text(result.get("webpage_url"))
        host = urlsplit(webpage_url).hostname if webpage_url else None
        if host is None or not YtDlpExtractor._host_matches_platform(host, target.platform):
            raise ServiceError("INVALID_URL", "平台返回了不受支持的视频地址。", 400)

    @staticmethod
    def _host_matches_platform(host: str, platform: str) -> bool:
        normalized = host.lower().rstrip(".")
        roots = ("douyin.com", "iesdouyin.com") if platform == "douyin" else ("bilibili.com", "b23.tv")
        return any(normalized == root or normalized.endswith(f".{root}") for root in roots)

    @staticmethod
    def _duration(value: object) -> int:
        if isinstance(value, bool):
            return 0
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
        return 0

    @staticmethod
    def _non_negative_int(value: object) -> int:
        if isinstance(value, bool):
            return 0
        if isinstance(value, (int, float)):
            return max(0, int(value))
        return 0

    @staticmethod
    def _optional_positive_int(value: object) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
        return None

    @staticmethod
    def _optional_positive_float(value: object) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)) and value >= 0:
            return float(value)
        return None

    @staticmethod
    def _safe_thumbnail(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        parsed = urlsplit(value)
        return value if parsed.scheme == "https" and bool(parsed.hostname) else None

    @staticmethod
    def _is_yt_dlp_error(exc: Exception) -> bool:
        return exc.__class__.__name__ == "DownloadError" and exc.__class__.__module__.startswith("yt_dlp")

    @staticmethod
    def _map_download_error(exc: Exception, platform: str) -> ServiceError:
        message = str(exc).lower()
        private_markers = ("private", "members-only", "premium", "sign in", "login required")
        cookie_markers = ("cookie", "captcha", "verify you are human", "fresh cookies")
        if any(marker in message for marker in private_markers):
            return ServiceError(
                "PRIVATE_OR_UNAVAILABLE",
                "该视频不可公开访问、需要登录或已失效。",
                422,
            )
        if platform == "douyin" and any(marker in message for marker in cookie_markers):
            return ServiceError(
                "COOKIE_REQUIRED",
                "抖音当前需要服务器更新解析 Cookie，请稍后重试。",
                503,
                retryable=True,
            )
        return ServiceError(
            "EXTRACTOR_TEMPORARILY_UNAVAILABLE",
            "平台暂时无法解析该视频，请稍后重试。",
            502,
            retryable=True,
        )

    @staticmethod
    def _text(value: object) -> str:
        return value.strip() if isinstance(value, str) else ""
