---
name: oh-story-short-write
description: 构思、写作和精修短篇网络小说，覆盖核心情绪、开篇入口、人物功能、场景链、信息释放、反转、高潮与结尾余韵。用于从零写短篇、续写指定场景、调整反转或压缩成稿。
license: MIT
metadata:
  openwrite:
    version: 0.7.2-openwrite.1
    agents: [goethe, dante]
    allow_tools: ["*"]
    references: [references/method.md]
    budget:
      max_instruction_chars: 5000
      max_reference_chars: 6000
      max_tool_calls: 20
---

# Oh Story 短篇写作

先确认目标篇幅、核心情绪和本轮交付范围。短篇优先维护一条完整的情绪与因果链，不把长篇式支线和背景解释塞进有限篇幅。

## 执行流程

1. 用“人物欲望 + 核心阻碍 + 决定性变化”概括故事，并明确读完后的主导情绪。
2. 设计能真实进入主线的开头异常、损失或期待，不使用与正文无关的夸张钩子。
3. 使用 `references/method.md` 建立有因果关系的场景链，安排信息、转向、核心选择和结算。
4. 先完成结构和情绪闭环，再压缩重复解释、无变化对话与无功能描写，最后处理句式和标点。
5. 用户只要诊断时输出问题与建议，不擅自重写全文。

## OpenWrite 边界

- 规划结果先作为候选；正式资产继续走 OpenWrite diff 与本轮明确确认。
- Dante 只根据当前作品的已确认信息写作，不从参考作品直接复制专名、独特桥段或标志性表达。
- 不套用上游目录、hooks 或脚本；只使用当前 Agent 已有工具。

本 Skill 改编自 [oh-story-claudecode](https://github.com/worldwonderer/oh-story-claudecode) 的 `story-short-write`，基于提交 `48a4789d1f542eb672addf8ccb5dbdc20e63be46`；MIT 许可见同目录 `LICENSE`。
