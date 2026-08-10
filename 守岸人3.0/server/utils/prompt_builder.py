# -*- coding: utf-8 -*-
"""
Prompt 构建流水线

参考 SillyTavern 的 PromptManager 设计：
1. 统一的 Message 中间格式
2. 基于位置的注入（before_char / after_char / depth）
3. 消息合并（连续同角色消息）
4. 多提供商格式转换
"""
from dataclasses import dataclass, field
from typing import Literal, Optional
import re


@dataclass
class PromptSegment:
    """Prompt 片段，可注入到不同位置"""
    identifier: str  # 唯一标识
    content: str  # 内容
    role: str = "system"  # system / user / assistant
    position: Literal["before_char", "after_char", "depth"] = "after_char"
    depth: int = 4  # 从消息末尾往前数的第 N 个角色切换点
    order: int = 0  # 同位置排序


@dataclass
class Message:
    """统一的消息格式"""
    role: Literal["system", "user", "assistant"]
    content: str
    name: Optional[str] = None  # 角色名（部分提供商支持）


def build_system_prompt(
    character,
    world_info_entries: list = None,
    memories: list = None,
    summary: str = None,
) -> str:
    """
    构建系统提示词

    Args:
        character: 角色卡对象
        world_info_entries: Lorebook 条目列表
        memories: 用户记忆列表
        summary: 对话摘要

    Returns:
        完整的系统提示词
    """
    segments = []

    # === before_char 位置 ===
    before_char = []
    if world_info_entries:
        for entry in world_info_entries:
            if entry.get("position") == "before_char":
                before_char.append(entry.get("content", ""))
    if before_char:
        segments.append("【前置知识】\n" + "\n".join(before_char))

    # === 角色人设（核心） ===
    if character.system_prompt:
        segments.append(character.system_prompt)
    else:
        char_parts = []
        if character.name:
            char_parts.append(f"你叫{character.name}。")
        if character.description:
            char_parts.append(character.description)
        if character.personality:
            char_parts.append(f"你的性格：{character.personality}")
        if char_parts:
            segments.append("\n".join(char_parts))

    # === after_char 位置 ===
    after_char = []
    if world_info_entries:
        for entry in world_info_entries:
            pos = entry.get("position", "after_char")
            if pos == "after_char" or pos not in ("before_char", "depth"):
                after_char.append(entry.get("content", ""))
    if after_char:
        segments.append("【世界信息】\n" + "\n".join(f"- {c}" for c in after_char))

    # === 用户记忆 ===
    if memories:
        memory_text = "\n".join(f"- {m.get('content', '')}" for m in memories[:10])
        segments.append(f"【关于用户的信息】\n{memory_text}")

    # === 对话摘要 ===
    if summary:
        segments.append(f"【之前对话摘要】\n{summary}")

    return "\n\n".join(segments)


def build_messages(
    system_prompt: str,
    conversation_history: list,
    max_history: int = 20,
    depth_segments: list = None,
) -> list:
    """
    构建发送给 LLM 的消息列表

    Args:
        system_prompt: 系统提示词
        conversation_history: 对话历史 [{"role": "user/assistant", "content": "..."}]
        max_history: 最大历史轮数
        depth_segments: 需要在指定深度注入的片段

    Returns:
        OpenAI 格式的消息列表
    """
    messages = [{"role": "system", "content": system_prompt}]

    # 只保留最近的对话
    recent = conversation_history[-max_history:]

    # 合并连续同角色消息
    merged = merge_consecutive_messages(recent)

    # 在指定深度注入片段
    if depth_segments:
        injected = inject_at_depth(merged, depth_segments)
        messages.extend(injected)
    else:
        messages.extend(merged)

    return messages


def merge_consecutive_messages(messages: list) -> list:
    """
    合并连续的同角色消息

    Args:
        messages: 消息列表

    Returns:
        合并后的消息列表
    """
    if not messages:
        return []

    merged = [messages[0].copy()]
    for msg in messages[1:]:
        if msg["role"] == merged[-1]["role"]:
            # 合并内容
            merged[-1]["content"] += "\n\n" + msg["content"]
        else:
            merged.append(msg.copy())
    return merged


def inject_at_depth(messages: list, segments: list) -> list:
    """
    在指定深度注入内容

    Args:
        messages: 消息列表
        segments: 要注入的片段列表 [{"depth": 4, "content": "...", "role": "system"}]

    Returns:
        注入后的消息列表
    """
    sorted_segments = sorted(
        enumerate(segments),
        key=lambda item: (
            item[1].get("depth", 4),
            item[1].get("order", 0),
            item[0],
        ),
    )
    role_changes = []  # 记录角色切换点的索引

    for i, msg in enumerate(messages):
        if i > 0 and msg["role"] != messages[i - 1]["role"]:
            role_changes.append(i)

    # 从末尾往前计算深度
    depth_map = {}
    for i, rc in enumerate(reversed(role_changes)):
        depth_map[i + 1] = rc

    insertions = {}
    for _, segment in sorted_segments:
        position = depth_map.get(segment.get("depth", 4), 0)
        insertions.setdefault(position, []).append({
            "role": segment.get("role", "system"),
            "content": segment.get("content", ""),
        })

    final = []
    for i, msg in enumerate(messages):
        final.extend(insertions.get(i, []))
        final.append(msg)
    if not messages:
        final.extend(insertions.get(0, []))

    return final


def convert_to_openai_format(messages: list) -> list:
    """转换为 OpenAI 格式"""
    return [{"role": m["role"], "content": m["content"]} for m in messages]


def convert_to_anthropic_format(messages: list) -> tuple:
    """
    转换为 Anthropic 格式

    Returns:
        (system_prompt, messages) 元组
    """
    system_parts = []
    chat_messages = []

    for msg in messages:
        if msg["role"] == "system":
            system_parts.append(msg["content"])
        else:
            chat_messages.append({"role": msg["role"], "content": msg["content"]})

    system = "\n\n".join(system_parts) if system_parts else ""
    return system, chat_messages


def convert_to_gemini_format(messages: list) -> list:
    """转换为 Gemini 格式"""
    contents = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        if msg["role"] == "system":
            # Gemini 没有 system role，作为 user 消息注入
            contents.append({"role": "user", "parts": [{"text": f"[System] {msg['content']}"}]})
        else:
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})
    return contents


def check_world_info_triggers(user_message: str, entries: list) -> list:
    """
    检查用户消息是否触发了 Lorebook 条目

    Args:
        user_message: 用户消息
        entries: 所有 Lorebook 条目

    Returns:
        被触发的条目列表
    """
    triggered = []
    for entry in entries:
        keyword = entry.get("keyword", "")
        if keyword and keyword.lower() in user_message.lower():
            triggered.append(entry)
    return triggered
