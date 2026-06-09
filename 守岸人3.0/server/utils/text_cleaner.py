# -*- coding: utf-8 -*-
"""文本清洗工具（保留自原项目）"""
import re
import unicodedata


def clean_text(text: str, mode: str = "tts") -> str:
    """
    文本清洗函数

    Args:
        text: 原始文本
        mode: "tts" 严格模式（只保留中文、数字、标点）
              "display" 宽松模式（保留颜文字等）

    Returns:
        清洗后的文本
    """
    if not text:
        return ""

    # 1. 标准化 Unicode
    text = unicodedata.normalize("NFKC", text)

    # 2. 移除 Emoji 和特殊符号
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF"
        "\U00002700-\U000027BF"
        "\U00002600-\U000026FF"
        "‍"
        "​"
        "️"
        "︎"
        "]+",
        flags=re.UNICODE,
    )
    text = emoji_pattern.sub("", text)

    # 3. 移除控制字符
    text = text.replace("\r", "")
    text = text.replace("\n", " ")
    text = text.replace("\t", " ")

    # 4. 移除 Markdown 格式
    text = re.sub(r"\*\*", "", text)
    text = re.sub(r"\*", "", text)
    text = re.sub(r"^>\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"`", "", text)
    text = re.sub(r"#{1,6}\s*", "", text)

    text = text.strip()

    # 5. TTS 模式：白名单过滤
    if mode == "tts":
        allowed = re.compile(
            r"[^一-龥"
            r"0-9"
            r"，。！？、；：""''（）【】《》…—~"
            r"\s]"
        )
        text = allowed.sub("", text)
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"[，。！？]{2,}", lambda m: m.group(0)[0], text)

    # 6. display 模式：移除英文
    elif mode == "display":
        text = re.sub(r"[a-zA-Z]", "", text)

    return text
