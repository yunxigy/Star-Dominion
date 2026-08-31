"""Shared helpers for safely locating long text replacement ranges."""

from __future__ import annotations

import re
from typing import Any

FOLDED_RANGE_ANCHOR_LENGTHS = (96, 48, 24, 12)
NORMALIZED_TEXT_MIN_CHARS = 12

_QUOTE_EQUIVALENTS = str.maketrans(
    {
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u201f": '"',
        "\uff02": '"',
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\uff07": "'",
    }
)


def normalized_text_spans(source: str, submitted: str) -> list[tuple[int, int]]:
    """Return source spans matching text after quote and whitespace normalization."""

    normalized_source, positions = _normalize_with_positions(str(source or ""))
    normalized_submitted, _ = _normalize_with_positions(str(submitted or "").strip())
    if not normalized_submitted:
        return []
    spans: list[tuple[int, int]] = []
    for match in re.finditer(re.escape(normalized_submitted), normalized_source):
        normalized_end = match.end() - 1
        spans.append((positions[match.start()], positions[normalized_end] + 1))
    return spans


def select_normalized_text_span(
    source: str,
    submitted: str,
    *,
    min_text_chars: int = NORMALIZED_TEXT_MIN_CHARS,
) -> dict[str, Any]:
    """Select one exact source span when only quotes or whitespace differ."""

    text = str(submitted or "").strip()
    if len(text) < min_text_chars:
        return {
            "ok": False,
            "error": "text_too_short_for_normalized_match",
            "message": "文本未达到安全规范化匹配阈值。",
            "details": {"submitted_chars": len(text)},
        }
    spans = normalized_text_spans(source, text)
    details = {
        "submitted_chars": len(text),
        "normalized_occurrences": len(spans),
        "normalizations": ["quote_style", "whitespace"],
    }
    if len(spans) > 1:
        return {
            "ok": False,
            "error": "ambiguous_normalized_text",
            "message": f"规范化后匹配到 {len(spans)} 处，已停止以避免误改。",
            "details": details,
        }
    if not spans:
        return {
            "ok": False,
            "error": "normalized_text_not_found",
            "message": "规范化引号与空白后仍未找到匹配。",
            "details": details,
        }
    start, end = spans[0]
    return {
        "ok": True,
        "start": start,
        "end": end,
        "source_text": source[start:end],
        "details": details,
    }


def _normalize_with_positions(value: str) -> tuple[str, list[int]]:
    normalized: list[str] = []
    positions: list[int] = []
    for index, raw_character in enumerate(value):
        character = raw_character.translate(_QUOTE_EQUIVALENTS)
        if character.isspace():
            continue
        normalized.append(character)
        positions.append(index)
    return "".join(normalized), positions


def select_folded_range_anchors(
    source: str,
    old_text: str,
    *,
    min_text_chars: int,
) -> dict[str, Any]:
    """Find one ordered range by folding long-text anchors down to 12 chars."""

    text = str(old_text or "").strip()
    if len(text) < min_text_chars:
        return {
            "ok": False,
            "error": "text_too_short_for_range_anchors",
            "message": "文本未达到自动首尾锚点阈值。",
            "details": {"submitted_chars": len(text)},
        }

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    attempted_lengths: list[int] = []
    seen_anchors: set[tuple[str, str]] = set()
    last_start = ""
    last_end = ""
    for anchor_chars in FOLDED_RANGE_ANCHOR_LENGTHS:
        if len(lines) >= 2:
            start_anchor = lines[0][:anchor_chars]
            end_anchor = lines[-1][-anchor_chars:]
        else:
            start_anchor = text[:anchor_chars]
            end_anchor = text[-anchor_chars:]
        if (
            not start_anchor
            or not end_anchor
            or start_anchor == end_anchor
            or (start_anchor, end_anchor) in seen_anchors
        ):
            continue
        seen_anchors.add((start_anchor, end_anchor))
        attempted_lengths.append(anchor_chars)
        last_start = start_anchor
        last_end = end_anchor

        start_spans = normalized_text_spans(source, start_anchor)
        end_spans = normalized_text_spans(source, end_anchor)
        start_occurrences = len(start_spans)
        end_occurrences = len(end_spans)
        details = {
            "anchor_chars": anchor_chars,
            "attempted_anchor_chars": list(attempted_lengths),
            "start_occurrences": start_occurrences,
            "end_occurrences": end_occurrences,
            "suggested_start_text": start_anchor,
            "suggested_end_text": end_anchor,
        }
        if start_occurrences > 1 or end_occurrences > 1:
            return {
                "ok": False,
                "error": "ambiguous_text_range",
                "message": (
                    f"{anchor_chars} 字符首尾锚点存在多处匹配，"
                    "已停止自动折半以避免误改。"
                ),
                "details": details,
            }
        if start_occurrences == 0 or end_occurrences == 0:
            continue

        start, start_end = start_spans[0]
        end, end_end = end_spans[0]
        if end < start_end:
            return {
                "ok": False,
                "error": "text_range_not_found",
                "message": "首尾锚点均唯一，但顺序不成立。",
                "details": details,
            }
        return {
            "ok": True,
            "start_text": source[start:start_end],
            "end_text": source[end:end_end],
            "details": details,
        }

    return {
        "ok": False,
        "error": "text_range_not_found",
        "message": "首尾锚点从 96 字符折半到 12 字符后仍未同时匹配。",
        "details": {
            "attempted_anchor_chars": attempted_lengths,
            "suggested_start_text": last_start,
            "suggested_end_text": last_end,
        },
    }
