---
name: oh-story-short-scan
description: 研究短篇网文平台与榜单样本，分析核心情绪、传播入口、标题简介承诺、篇幅、开头异常、反转或结算方式和热点寿命。用于短篇扫榜、选题比较、风口判断或投稿方向验证。
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

# Oh Story 短篇市场研究

把短篇市场视为情绪和传播入口快速变化的样本空间。先确认平台、内容形态、榜单口径、目标读者、采样日期和作者可稳定交付的情绪类型。

## 执行流程

1. 收集带链接与日期的公开样本，记录榜单、篇幅、题材、标题承诺、开头入口、核心情绪和结算方式。
2. 使用 `references/method.md` 比较传播包装与正文交付，识别高频模式、新信号和过热风险。
3. 分开报告数据事实、分析推断和选题建议；小样本不宣称趋势。
4. 形成多个短篇候选，写清情绪目标、标题或开篇测试、场景承载力、差异化、投稿适配和主要风险。
5. 把候选交给 Goethe 讨论，不自动写入当前项目或直接生成成稿。

## 数据边界

- 不运行上游 CDP、浏览器或抓榜脚本，不绕过登录、付费和访问限制。
- 无实时来源时明确说明，只提供采样方案和待查清单。
- 留意推荐位、影视热点、作者影响力、免费试读范围和平台活动造成的偏差。

本 Skill 改编自 [oh-story-claudecode](https://github.com/worldwonderer/oh-story-claudecode) 的 `story-short-scan`，基于提交 `48a4789d1f542eb672addf8ccb5dbdc20e63be46`；MIT 许可见同目录 `LICENSE`。
