import pytest

from tools.llm.response import (
    ProviderResponseError,
    classify_response,
    load_structured_mapping,
    redact_sensitive_text,
    validate_tool_arguments,
)


@pytest.mark.parametrize(
    ("content", "finish_reason", "reasoning", "code"),
    [
        ("", "", "", "MODEL_EMPTY_RESPONSE"),
        ("", "stop", "internal reasoning", "MODEL_REASONING_ONLY"),
        ("partial", "length", "", "MODEL_OUTPUT_TRUNCATED"),
    ],
)
def test_provider_response_classification(content, finish_reason, reasoning, code):
    with pytest.raises(ProviderResponseError) as raised:
        classify_response(content, finish_reason=finish_reason, reasoning=reasoning)
    assert raised.value.code == code


def test_structured_parser_accepts_preface_and_rejects_malformed_output():
    payload = load_structured_mapping(
        "结果如下：\n\nstate_updates:\n  current_state: 新状态",
        required_keys=("state_updates",),
    )
    assert payload["state_updates"]["current_state"] == "新状态"

    with pytest.raises(ProviderResponseError) as raised:
        load_structured_mapping("not: [valid", required_keys=("state_updates",))
    assert raised.value.code == "MALFORMED_STRUCTURED_OUTPUT"


def test_tool_arguments_are_validated_and_credentials_are_redacted():
    with pytest.raises(ProviderResponseError) as raised:
        validate_tool_arguments(
            [
                {
                    "name": "stage_outline_edits",
                    "arguments": '{"edits":[{"old_text":"未闭合',
                }
            ]
        )
    assert raised.value.code == "MALFORMED_TOOL_ARGUMENTS"
    assert raised.value.details["tool_name"] == "stage_outline_edits"
    assert raised.value.details["line"] == 1
    assert raised.value.details["likely_truncated"] is True
    assert "字符串没有闭合" in str(raised.value)
    assert "sk-" not in redact_sensitive_text("authorization: Bearer sk-example123456")
    assert "private-value" not in redact_sensitive_text(
        "Authorization: Bearer private-value"
    )


def test_wrapped_provider_timeout_has_stable_code_and_no_secret():
    from types import SimpleNamespace

    from tools.llm.client import LLMClient

    client = LLMClient.__new__(LLMClient)
    client.config = SimpleNamespace(base_url="https://example.test/v1?api_key=hidden")
    error = client._wrap_error(RuntimeError("request timed out using sk-example123456"))

    assert error.code == "PROVIDER_TIMEOUT"
    assert "sk-" not in str(error)
