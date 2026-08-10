from server.services.lorebook_matcher import match_rule, split_keys
from server.services.lorebook_types import LorebookRule


def rule(**overrides):
    values = {
        "id": "entry-1",
        "content": "Black Shores",
        "primary_keys": ("shore",),
        "secondary_keys": (),
    }
    values.update(overrides)
    return LorebookRule(**values)


def test_selective_and_requires_primary_and_secondary():
    item = rule(secondary_keys=("rover",), selective_logic="and")
    assert match_rule(item, "the rover reached the shore").matched is True
    assert match_rule(item, "the shore is quiet").reason == "secondary_not_matched"


def test_case_whole_word_and_regex_are_explicit():
    assert match_rule(rule(case_sensitive=True), "SHORE").matched is False
    assert match_rule(rule(match_whole_words=True), "offshore").matched is False
    assert match_rule(rule(primary_keys=("/shores?$/",)), "black shore").matched is True


def test_invalid_regex_is_isolated():
    result = match_rule(rule(primary_keys=("/[invalid/",)), "anything")
    assert result.matched is False
    assert result.error == "invalid_regular_expression"


def test_split_keys_trims_and_discards_empty_values():
    assert split_keys(" shore, , rover ") == ("shore", "rover")
    assert split_keys(None) == ()
