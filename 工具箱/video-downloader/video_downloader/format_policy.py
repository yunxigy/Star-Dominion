from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

from .models import QualityOption


@dataclass(frozen=True)
class FormatSelection:
    public: QualityOption
    selector: str
    merge_extension: str | None


@dataclass(frozen=True)
class _Candidate:
    selection: FormatSelection
    rank: tuple[int, int, int, float]


class FormatPolicy:
    def __init__(self, max_file_bytes: int) -> None:
        self._max_file_bytes = max_file_bytes

    def build(self, platform: str, formats: list[dict[str, Any]]) -> list[FormatSelection]:
        audio = self._best_audio(formats)
        by_height: dict[int, _Candidate] = {}
        seen_selectors: set[str] = set()

        for raw in formats:
            candidate = self._candidate(platform, raw, audio)
            if candidate is None or candidate.selection.selector in seen_selectors:
                continue
            seen_selectors.add(candidate.selection.selector)
            height = candidate.selection.public.height
            current = by_height.get(height)
            if current is None or candidate.rank > current.rank:
                by_height[height] = candidate

        return [by_height[height].selection for height in sorted(by_height, reverse=True)]

    def _candidate(
        self,
        platform: str,
        raw: dict[str, Any],
        audio: dict[str, Any] | None,
    ) -> _Candidate | None:
        format_id = self._text(raw.get("format_id"))
        height = self._positive_int(raw.get("height"))
        vcodec = self._text(raw.get("vcodec")).lower()
        acodec = self._text(raw.get("acodec")).lower()
        if not format_id or height is None or not vcodec or vcodec == "none":
            return None

        extension = self._text(raw.get("ext")).lower() or "mp4"
        progressive = bool(acodec and acodec != "none")
        selector = format_id
        requires_merge = False
        has_audio = progressive
        merge_extension: str | None = None
        estimated_bytes = self._size(raw)

        if not progressive and audio is not None:
            audio_id = self._text(audio.get("format_id"))
            if audio_id:
                selector = f"{format_id}+{audio_id}"
                requires_merge = True
                has_audio = True
                merge_extension = self._merge_extension(extension, vcodec, audio)
                audio_size = self._size(audio)
                estimated_bytes = (
                    estimated_bytes + audio_size
                    if estimated_bytes is not None and audio_size is not None
                    else None
                )
                extension = merge_extension

        if estimated_bytes is not None and estimated_bytes > self._max_file_bytes:
            return None

        public_id = self._public_id(platform, selector)
        public = QualityOption(
            id=public_id,
            label=f"{height}P",
            height=height,
            extension=extension,
            estimated_bytes=estimated_bytes,
            requires_merge=requires_merge,
            has_audio=has_audio,
        )
        rank = (
            int(extension == "mp4"),
            int(vcodec.startswith(("avc", "h264"))),
            int(progressive),
            self._number(raw.get("tbr")) or 0.0,
        )
        return _Candidate(
            selection=FormatSelection(
                public=public,
                selector=selector,
                merge_extension=merge_extension,
            ),
            rank=rank,
        )

    @classmethod
    def _best_audio(cls, formats: list[dict[str, Any]]) -> dict[str, Any] | None:
        candidates: list[tuple[tuple[int, int, float], dict[str, Any]]] = []
        for raw in formats:
            format_id = cls._text(raw.get("format_id"))
            vcodec = cls._text(raw.get("vcodec")).lower()
            acodec = cls._text(raw.get("acodec")).lower()
            if not format_id or vcodec != "none" or not acodec or acodec == "none":
                continue
            extension = cls._text(raw.get("ext")).lower()
            rank = (
                int(extension in {"m4a", "mp4"}),
                int(acodec.startswith(("mp4a", "aac"))),
                cls._number(raw.get("abr")) or 0.0,
            )
            candidates.append((rank, raw))
        if not candidates:
            return None
        return max(candidates, key=lambda item: item[0])[1]

    @staticmethod
    def _merge_extension(video_extension: str, vcodec: str, audio: dict[str, Any]) -> str:
        audio_extension = FormatPolicy._text(audio.get("ext")).lower()
        if video_extension in {"mp4", "m4v"} and audio_extension in {"m4a", "mp4"}:
            return "mp4"
        if vcodec.startswith(("avc", "h264", "hev", "h265", "av01")):
            return "mp4"
        return "webm" if video_extension == "webm" else video_extension

    @staticmethod
    def _public_id(platform: str, selector: str) -> str:
        digest = hashlib.blake2s(
            f"{platform}:{selector}".encode("utf-8"),
            digest_size=8,
        ).hexdigest()
        return f"q_{digest}"

    @classmethod
    def _size(cls, raw: dict[str, Any]) -> int | None:
        for key in ("filesize", "filesize_approx"):
            value = cls._number(raw.get(key))
            if value is not None and value > 0:
                return int(value)
        return None

    @staticmethod
    def _positive_int(value: object) -> int | None:
        number = FormatPolicy._number(value)
        if number is None or number <= 0:
            return None
        return int(number)

    @staticmethod
    def _number(value: object) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        return None

    @staticmethod
    def _text(value: object) -> str:
        return value.strip() if isinstance(value, str) else ""
