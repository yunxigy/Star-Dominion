from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

from .config import VideoSettings
from .errors import ServiceError
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


class YtDlpExtractor:
    def __init__(
        self,
        settings: VideoSettings,
        ydl_factory: YdlFactory | None = None,
    ) -> None:
        self._settings = settings
        self._ydl_factory = ydl_factory or _default_ydl_factory
        self._format_policy = FormatPolicy(settings.max_file_bytes)

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
