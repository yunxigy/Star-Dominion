---
name: oh-story-short-analyze
description: 证据化拆解用户合法提供的短篇小说，分析开头入口、场景因果链、人物功能、信息释放、核心情绪、反转公平性、高潮结算和可迁移技法。用于拆短篇、分析爆款结构或形成写作对标。
license: MIT
metadata:
  openwrite:
    version: 0.7.2-openwrite.1
    agents: [goethe]
    allow_tools: ["*"]
    references: [references/method.md]
    budget:
      max_instruction_chars: 5000
      max_reference_chars: 6000
      max_tool_calls: 20
---

# Oh Story 短篇拆解

先确认文本完整性、目标篇幅和分析目标。若作品实际上依赖多卷、多阶段升级或大量章节，建议改用 `@oh-story-long-analyze`，不要为了套短篇模板截断结构。

## 执行流程

1. 建立完整场景边界与因果链，再做题材、情绪和反转判断。
2. 使用 `references/method.md` 分析开篇承诺、中段升级、信息控制、人物选择、高潮结算和结尾余韵。
3. 每条判断引用场景或段落证据，区分事实、推断与可迁移建议。
4. 只提炼功能和机制，不复现足以替代原作的全文梗概，不复制独特表达。
5. 输出结构诊断、情绪曲线、反转审计、人物功能和候选写法公式；明确哪些结论受样本限制。

## OpenWrite 边界

- 把材料交给现有参考库流程，不创建上游目录或元数据文件。
- 任何写作候选都不能直接进入当前小说真源；先由 Goethe 讨论，再预览和确认。
- 不执行上游脚本或自定义 Agent 流水线；只使用当前 OpenWrite 权限。

本 Skill 改编自 [oh-story-claudecode](https://github.com/worldwonderer/oh-story-claudecode) 的 `story-short-analyze`，基于提交 `48a4789d1f542eb672addf8ccb5dbdc20e63be46`；MIT 许可见同目录 `LICENSE`。
