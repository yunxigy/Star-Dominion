from __future__ import annotations

import json

from tools.llm import LLMClient, LLMConfig, Message


def test_deepseek_flash_connectivity(live_env, write_artifact):
    config = LLMConfig.from_env()
    client = LLMClient(config)
    response = client.chat(
        [
            Message("system", "Return the requested marker exactly and do not add punctuation."),
            Message("user", "Return OPENWRITE_LIVE_OK"),
        ],
        temperature=0,
        max_tokens=512,
    )

    write_artifact(
        "deepseek_connectivity.json",
        {"model": response.model, "content": response.content, "usage": response.usage},
    )
    assert "OPENWRITE_LIVE_OK" in response.content
    assert response.model


def test_deepseek_flash_openai_tool_calling(live_env, write_artifact):
    client = LLMClient(LLMConfig.from_env())
    response = client.chat_with_tools(
        [
            Message(
                "system",
                "You must call the add_numbers tool once. Do not calculate the answer yourself.",
            ),
            Message("user", "Use the tool to add 7 and 6."),
        ],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "add_numbers",
                    "description": "Add two numbers.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "a": {"type": "number"},
                            "b": {"type": "number"},
                        },
                        "required": ["a", "b"],
                    },
                },
            }
        ],
        temperature=0,
        max_tokens=256,
    )

    write_artifact(
        "deepseek_tool_calling.json",
        {"content": response.content, "tool_calls": response.tool_calls, "usage": response.usage},
    )
    assert response.tool_calls, "provider returned no OpenAI-compatible tool call"
    call = response.tool_calls[0]
    assert call["name"] == "add_numbers"
    arguments = json.loads(call["arguments"])
    assert float(arguments["a"]) + float(arguments["b"]) == 13
