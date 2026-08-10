import re

from .lorebook_types import LorebookRule, MatchResult


def split_keys(value: str | None) -> tuple[str, ...]:
    return tuple(part.strip() for part in (value or "").split(",") if part.strip())


def _match_key(rule: LorebookRule, key: str, text: str) -> tuple[bool, str | None]:
    flags = 0 if rule.case_sensitive else re.IGNORECASE
    if key.startswith("/") and key.endswith("/") and len(key) > 2:
        try:
            return re.search(key[1:-1], text, flags) is not None, None
        except re.error:
            return False, "invalid_regular_expression"

    pattern = re.escape(key)
    if rule.match_whole_words:
        pattern = rf"(?<!\w){pattern}(?!\w)"
    return re.search(pattern, text, flags) is not None, None


def match_rule(rule: LorebookRule, text: str) -> MatchResult:
    if rule.constant:
        return MatchResult(True, "constant")

    primary_matches: list[str] = []
    secondary_matches: list[str] = []
    for target, keys in (
        (primary_matches, rule.primary_keys),
        (secondary_matches, rule.secondary_keys),
    ):
        for key in keys:
            matched, error = _match_key(rule, key, text)
            if error:
                return MatchResult(False, "invalid_rule", error=error)
            if matched:
                target.append(key)

    primary = bool(primary_matches)
    secondary = bool(secondary_matches)
    if not rule.secondary_keys:
        matched = primary
    elif rule.selective_logic == "and":
        matched = primary and secondary
    else:
        matched = primary or secondary

    reason = "matched" if matched else (
        "secondary_not_matched" if primary and not secondary else "keyword_not_matched"
    )
    return MatchResult(matched, reason, tuple(primary_matches + secondary_matches))
