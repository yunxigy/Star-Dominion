"""Deterministic safety guidance for destructive manuscript requests."""

MANUAL_CHAPTER_DELETE_GUIDANCE = (
    "为了避免 AI 误删，Agent 不会直接删除正文章节，也不会通过改写大纲来绕过保护。"
    "请在 Studio 左侧进入“正文”，打开最新章节，点击编辑器右上角的“删除正文”，"
    "再输入页面提示的章节 ID 确认。系统会在删除前自动保留一个正文版本，"
    "并保持大纲、角色和世界设定不变。如需清空全部正文，请从最新章开始依次向前删除。"
)


def manual_chapter_delete_guidance(text: str) -> str:
    """Return safety guidance when a user asks an agent to delete manuscripts."""
    compact = "".join(str(text or "").lower().split())
    if not compact or not any(word in compact for word in ("删", "清空", "移除")):
        return ""
    explicit_manuscript = any(
        phrase in compact
        for phrase in (
            "正文",
            "已写章节",
            "写好的章节",
            "现有章节",
            "已经写的章节",
        )
    )
    broad_chapter_request = any(
        phrase in compact for phrase in ("全部章节", "所有章节", "章节都删")
    )
    if "大纲" in compact and not explicit_manuscript:
        return ""
    return MANUAL_CHAPTER_DELETE_GUIDANCE if explicit_manuscript or broad_chapter_request else ""
