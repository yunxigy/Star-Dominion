"""WebSocket message schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class WsTextDelta(BaseModel):
    type: str = "text_delta"
    content: str


class WsToolCall(BaseModel):
    type: str = "tool_call"
    name: str
    args: dict[str, Any] = {}


class WsToolResult(BaseModel):
    type: str = "tool_result"
    name: str
    result: Any = None
    error: str | None = None


class WsMessageComplete(BaseModel):
    type: str = "message_complete"
    content: str


class WsError(BaseModel):
    type: str = "error"
    message: str


class WsUserMessage(BaseModel):
    type: str = "user_message"
    content: str


class WsCancel(BaseModel):
    type: str = "cancel"


class WsProgress(BaseModel):
    type: str = "progress"
    stage: str = ""
    percent: int = 0
    message: str = ""


class WsTaskCompleted(BaseModel):
    type: str = "completed"
    result: Any = None


class WsTaskFailed(BaseModel):
    type: str = "failed"
    error: str = ""
