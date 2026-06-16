"""WebSocket routes — chat with Dante/Goethe agents."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from server.dependencies import get_config

router = APIRouter(tags=["websocket"])
logger = logging.getLogger(__name__)

# Active agent sessions: key = "agent_type:novel_id"
_agent_sessions: dict[str, object] = {}
# Active background tasks
_tasks: dict[str, asyncio.Task] = {}
_task_progress: dict[str, dict] = {}


async def _send_ws(websocket: WebSocket, msg: dict) -> None:
    """Send JSON to client, ignoring if already disconnected."""
    try:
        await websocket.send_json(msg)
    except Exception as e:
        logger.debug("WebSocket send failed (client likely disconnected): %s", e)


def _build_agent(agent_type: str, project_root: Path, novel_id: str):
    """Build a DanteChatAgent or GoetheChatAgent with proper tool layers."""
    if agent_type == "dante":
        from tools.agent.dante import DanteChatAgent

        agent = DanteChatAgent(
            project_root=project_root,
            novel_id=novel_id,
        )
    elif agent_type == "goethe":
        from tools.goethe import GoetheChatAgent

        agent = GoetheChatAgent(
            project_root=project_root,
            novel_id=novel_id,
        )
    else:
        raise ValueError(f"Unknown agent type: {agent_type}")
    return agent


def _build_react_agent(agent_type: str, project_root: Path, novel_id: str = ""):
    """Build a ReActAgent with the appropriate tools and system prompt."""
    from tools.llm.client import LLMClient, LLMConfig

    llm_config = LLMConfig.from_env()
    client = LLMClient(llm_config)

    from tools.agent.react import OPENWRITE_SYSTEM_PROMPT, OPENWRITE_TOOLS, ReActAgent

    agent = ReActAgent(
        client=client,
        model=llm_config.model,
        tools=OPENWRITE_TOOLS,
        system_prompt=OPENWRITE_SYSTEM_PROMPT,
        max_turns=20,
    )

    # Register tool executors so the agent can actually execute tools
    from tools.cli import build_cli_tool_executors

    executors = build_cli_tool_executors(project_root)
    agent._register_tool_executors(executors)

    # Store novel_id for tool context
    agent._novel_id = novel_id

    return agent


@router.websocket("/ws/chat/{agent_type}")
async def chat_websocket(websocket: WebSocket, agent_type: str):
    """Dante/Goethe chat via WebSocket.

    Protocol (server -> client):
        {"type": "system",       "content": "..."}           — startup recovery
        {"type": "text_delta",   "content": "..."}           — streaming text
        {"type": "tool_call",    "name": "...", "args": {}}  — tool invocation
        {"type": "tool_result",  "name": "...", "result": ...} — tool output
        {"type": "message_complete", "content": "..."}       — final message
        {"type": "turn_saved",   "turns": N}                 — session persisted
        {"type": "error",        "message": "..."}           — error

    Protocol (client -> server):
        {"type": "user_message", "content": "..."}           — chat input
        {"type": "cancel"}                                   — abort current
    """
    await websocket.accept()

    # Resolve novel_id
    novel_id = websocket.query_params.get("novel_id", "")
    if not novel_id:
        config = get_config()
        config_path = config.project_root / "novel_config.yaml"
        if config_path.exists():
            import yaml

            cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
            novel_id = cfg.get("novel_id", "current")
        else:
            novel_id = "current"

    project_root = get_config().project_root
    session_key = f"{agent_type}:{novel_id}"

    try:
        # Build agent (reuse cached or create new)
        if session_key in _agent_sessions:
            agent = _agent_sessions[session_key]
        else:
            agent = _build_agent(agent_type, project_root, novel_id)
            _agent_sessions[session_key] = agent

        # Startup — load session state, build recovery prompt
        startup = agent.startup()
        if startup.recovery_prompt:
            await _send_ws(websocket, {
                "type": "system",
                "content": startup.recovery_prompt,
            })

        # Build ReAct agent
        react_agent = _build_react_agent(agent_type, project_root, novel_id)

        # Send current book state info
        book_state = getattr(startup, "book_state", None)
        if book_state:
            await _send_ws(websocket, {
                "type": "state_info",
                "stage": book_state.stage.value if hasattr(book_state.stage, 'value') else str(book_state.stage),
                "current_arc": book_state.current_arc or "",
                "current_chapter": book_state.current_chapter or "",
                "pending_confirmation": book_state.pending_confirmation or "",
            })

        turns_processed = 0

        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                break

            msg_type = data.get("type", "")

            if msg_type == "cancel":
                # Cancel is informational; the current run will finish on its own
                await _send_ws(websocket, {"type": "cancelled"})
                continue

            if msg_type != "user_message":
                continue

            user_msg = data.get("content", "").strip()
            if not user_msg:
                continue

            # Append user turn to session state (mirrors DanteChatAgent._append_user_turn)
            try:
                if hasattr(agent, '_append_user_turn'):
                    agent._append_user_turn(user_msg)
            except Exception:
                pass

            # Callbacks that bridge to WebSocket
            async def on_tool_call(tc_id: str, name: str, args: dict):
                await _send_ws(websocket, {
                    "type": "tool_call",
                    "id": tc_id or str(uuid.uuid4())[:8],
                    "name": name,
                    "args": args,
                })

            async def on_tool_result(tc_id: str, name: str, result: str):
                # Try to parse result as JSON for structured display
                parsed = result
                try:
                    parsed = json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    pass
                await _send_ws(websocket, {
                    "type": "tool_result",
                    "id": tc_id,
                    "name": name,
                    "result": parsed,
                })

            async def on_message(content: str):
                await _send_ws(websocket, {
                    "type": "text_delta",
                    "content": content,
                })

            # Run agent
            try:
                # Build context messages from session state for continuity
                context_messages = None
                if hasattr(agent, 'session_state') and agent.session_state:
                    recent = agent.session_state.recent_turns or []
                    if recent:
                        from tools.llm.client import Message as LLMMessage

                        context_messages = []
                        for turn in recent[-4:]:  # last 4 turns for context
                            role = getattr(turn, "role", None) or (turn.get("role") if isinstance(turn, dict) else "assistant")
                            content_val = getattr(turn, "content", None) or (turn.get("content") if isinstance(turn, dict) else "")
                            if role in ("user", "assistant") and content_val:
                                context_messages.append(LLMMessage(role=role, content=content_val))

                result = await react_agent.run(
                    user_msg,
                    on_tool_call=on_tool_call,
                    on_tool_result=on_tool_result,
                    on_message=on_message,
                    context_messages=context_messages,
                )
                await _send_ws(websocket, {
                    "type": "message_complete",
                    "content": result,
                })

                # Append assistant turn to session state
                try:
                    if hasattr(agent, '_append_assistant_turn'):
                        agent._append_assistant_turn(result)
                    if hasattr(agent, 'session_store') and hasattr(agent, 'session_state'):
                        agent.session_state.last_action = "chat"
                        agent.session_store.save(agent.session_state)
                except Exception as save_err:
                    logger.warning("Failed to save session state: %s", save_err)

                turns_processed += 1
                await _send_ws(websocket, {
                    "type": "turn_saved",
                    "turns": turns_processed,
                })

            except Exception as e:
                logger.exception("Agent run failed for %s", session_key)
                # Save error state
                try:
                    if hasattr(agent, 'session_state') and agent.session_state:
                        agent.session_state.last_action = "react_error"
                        if hasattr(agent, 'session_store'):
                            agent.session_store.save(agent.session_state)
                except Exception:
                    pass

                await _send_ws(websocket, {
                    "type": "error",
                    "message": str(e),
                })

    except WebSocketDisconnect:
        logger.info("Chat WebSocket disconnected: %s", session_key)
    except Exception as e:
        logger.exception("Chat WebSocket error for %s", session_key)
        await _send_ws(websocket, {"type": "error", "message": str(e)})


@router.websocket("/ws/progress/{task_id}")
async def progress_websocket(websocket: WebSocket, task_id: str):
    """Long-running task progress via WebSocket."""
    await websocket.accept()

    try:
        while True:
            progress = _task_progress.get(task_id)
            if progress:
                await websocket.send_json(progress)
                if progress.get("type") in ("completed", "failed"):
                    break
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass


# ── 自动写作 ──────────────────────────────────────────────────

@router.websocket("/ws/auto-write")
async def auto_write_websocket(websocket: WebSocket):
    """自动写作 WebSocket — 持续写到完本。

    Protocol (client -> server):
        {"type": "start", "config": {...}}
        {"type": "cancel"}
        {"type": "pause"}
        {"type": "resume"}

    Protocol (server -> client):
        {"type": "started",         "total": N, "chapters": [...]}
        {"type": "chapter_start",   "chapter": "ch_001", "index": 0, "total": N}
        {"type": "phase",           "chapter": "ch_001", "phase": "writing", "attempt": 0}
        {"type": "tool_call",       "id": "...", "name": "write_chapter", "args": {...}}
        {"type": "tool_result",     "id": "...", "name": "write_chapter", "result": {...}}
        {"type": "chapter_done",    "chapter": "ch_001", "score": 85, ...}
        {"type": "chapter_revising","chapter": "ch_001", "attempt": 2, "max": 3, ...}
        {"type": "completed",       "summary": {...}}
        {"type": "cancelled"}
        {"type": "error",           "message": "..."}
    """
    await websocket.accept()

    project_root = get_config().project_root

    # Resolve novel_id from query params or config
    novel_id = websocket.query_params.get("novel_id", "")
    if not novel_id:
        config_path = project_root / "novel_config.yaml"
        if config_path.exists():
            import yaml
            cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
            novel_id = cfg.get("novel_id", "current")
        else:
            novel_id = "current"

    writer = None
    run_task: asyncio.Task | None = None

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                break

            msg_type = data.get("type", "")

            if msg_type == "start":
                if run_task is not None and not run_task.done():
                    await _send_ws(websocket, {"type": "error", "message": "自动写作已在运行中"})
                    continue

                from tools.auto_writer import AutoWriter, AutoWriterConfig

                cfg_data = data.get("config", {})
                config = AutoWriterConfig(
                    max_retries=int(cfg_data.get("max_retries", 3)),
                    score_threshold=int(cfg_data.get("score_threshold", 70)),
                    target_words=int(cfg_data.get("target_words", 3000)),
                    guidance=str(cfg_data.get("guidance", "")),
                    start_chapter=str(cfg_data.get("start_chapter", "")),
                    max_chapters=int(cfg_data.get("max_chapters", 0)),
                    auto_outline=bool(cfg_data.get("auto_outline", True)),
                    outline_batch=int(cfg_data.get("outline_batch", 5)),
                )

                _loop = asyncio.get_running_loop()

                def on_progress(event: dict):
                    """同步回调 → 异步发送（安全地调度到事件循环）。"""
                    _loop.call_soon_threadsafe(
                        lambda e=event: asyncio.ensure_future(_send_ws(websocket, e))
                    )

                writer = AutoWriter(project_root, config, on_progress, novel_id=novel_id)

                async def _run():
                    try:
                        result = await writer.run()
                        await _send_ws(websocket, {
                            "type": "completed",
                            "summary": {
                                "total_written": result.total_written,
                                "total_passed": result.total_passed,
                                "stopped_reason": result.stopped_reason,
                                "chapters": [
                                    {
                                        "chapter_id": cr.chapter_id,
                                        "score": cr.score,
                                        "passed": cr.passed,
                                        "retries": cr.retries,
                                        "word_count": cr.word_count,
                                        "error": cr.error,
                                    }
                                    for cr in result.chapters
                                ],
                            },
                        })
                    except Exception as e:
                        logger.exception("AutoWriter run failed")
                        await _send_ws(websocket, {"type": "error", "message": str(e)})

                run_task = asyncio.create_task(_run())

            elif msg_type == "cancel":
                if writer:
                    writer.cancel()
                if run_task and not run_task.done():
                    run_task.cancel()
                await _send_ws(websocket, {"type": "cancelled"})

            elif msg_type == "pause":
                if writer:
                    writer.pause()
                    await _send_ws(websocket, {"type": "paused"})

            elif msg_type == "resume":
                if writer:
                    writer.resume()
                    await _send_ws(websocket, {"type": "resumed"})

    except WebSocketDisconnect:
        logger.info("Auto-write WebSocket disconnected")
        if writer:
            writer.cancel()
        if run_task and not run_task.done():
            run_task.cancel()
    except Exception as e:
        logger.exception("Auto-write WebSocket error")
        await _send_ws(websocket, {"type": "error", "message": str(e)})
