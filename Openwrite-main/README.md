<p align="center">
  <h1 align="center">OpenWrite</h1>
  <p align="center">AI 驱动的长篇小说创作平台 | Web 端 + CLI 双模式</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-5.4.0-2563eb" alt="Version">
  <img src="https://img.shields.io/badge/python-%3E%3D3.10-22c55e?logo=python" alt="Python >= 3.10">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
</p>

---

## 简介

OpenWrite 是一个 AI 驱动的长篇小说创作平台，提供 **Web 端可视化界面** 和 **CLI 命令行** 双模式。它不是一个简单的 AI 对话包装器，而是一套完整的长篇小说生产线——从灵感整理、人物设定、大纲规划，到章节写作、审查校对、风格合成，全部在同一条工作流里完成。

核心理念：**长篇小说不是一次性 prompt，而是一场持续数月的协作。**

## 两种使用方式

### Web 端（推荐）

基于 FastAPI + WebSocket 的 Web 界面，提供：

- 可视化的项目管理和进度追踪
- 实时流式输出的 AI 写作对话
- 自动写作模块（AutoWriter）：设定目标字数后 AI 自动推进，无需逐章手动指挥
- 人物卡片、大纲树、设定文档的图形化编辑
- 一键导出完整小说

### CLI 命令行

适合高级用户和脚本化场景：

- `openwrite goethe` — 长会话规划入口，整理灵感、建立设定
- `openwrite dante` — 正文创作主入口，持续写章、审查、推进
- `openwrite write` / `openwrite review` — 精确控制写作和审查

## 核心功能

| 功能 | 说明 |
|------|------|
| **Goethe 规划 Agent** | 长会话规划，汇总灵感、建立人物、设定、大纲，成熟后交接给 Dante |
| **Dante 创作 Agent** | 正文推进主 Agent，自动决定何时写章、审查、回修资产 |
| **AutoWriter 自动写作** | 设定目标字数后自动推进多个章节，支持暂停/恢复 |
| **风格合成** | 提供参考文章，AI 拆解学习后生成风格说明书，指导全书写作 |
| **上下文组装** | 写章前自动组装 canonical packet（大纲、设定、人物、前章、风格规则） |
| **章节审查** | 独立审查流程，检查设定冲突、人物一致性、情节合理性 |
| **WebSocket 流式输出** | Web 端实时显示 AI 生成过程，支持中途打断和调整 |

## 工作流

```
灵感 → Goethe（规划）→ 人物/设定/大纲 → Dante（创作）→ 章节正文 → 审查 → 修订 → 下一章
                                                    ↑               |
                                                    └───────────────┘
                                                      持续迭代推进
```

### 推荐流程

1. **新书启动**：`openwrite goethe`，和 AI 聊清楚题材、主角、核心冲突
2. **资产沉淀**：让 Goethe 汇总成基础设定、人物草案、可写范围大纲
3. **正式交接**：Goethe 显式 handoff 给 Dante
4. **日常创作**：`openwrite dante`，告诉 Dante "写第六章，3500 字，冲突更直接"
5. **审查修订**：Dante 自审后提示设定冲突，你确认后继续推进

## 技术架构

```
OpenWrite/
├── src/openwrite/          # 核心 Python 包
│   ├── agents/             # Goethe & Dante Agent
│   ├── auto_writer.py      # 自动写作模块
│   ├── web/                # FastAPI Web 服务
│   │   ├── app.py          # FastAPI 应用
│   │   ├── api/            # REST API 路由
│   │   ├── websocket/      # WebSocket 实时通信
│   │   └── static/         # 前端静态资源
│   ├── cli/                # CLI 入口
│   ├── core/               # 核心引擎（上下文组装、写章、审查）
│   └── style/              # 风格合成模块
├── data/novels/{novel_id}/
│   ├── src/                # 确认版真源（大纲、人物、设定）
│   └── data/               # 运行态（手稿、工作流、缓存）
└── pyproject.toml
```

## 快速开始

### 安装

```bash
git clone https://github.com/yunxigy/Star-Dominion.git
cd Star-Dominion/Openwrite-main
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e .
```

### 配置

创建 `.env` 文件：

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

支持任何兼容 OpenAI API 格式的模型服务。

### Web 端启动

```bash
python -m openwrite.web.app
# 或
uvicorn openwrite.web.app:app --host 0.0.0.0 --port 8000
```

访问 `http://localhost:8000` 开始使用。

### CLI 使用

```bash
# 新书规划
openwrite goethe

# 正文创作
openwrite dante

# 查看状态
openwrite status
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | 模型 API Key | 无 |
| `LLM_PROVIDER` | 提供商 | `openai` |
| `LLM_MODEL` | 模型名 | `gpt-4o-mini` |
| `LLM_BASE_URL` | 自定义兼容网关 | `https://api.openai.com/v1` |
| `LLM_TEMPERATURE` | 默认温度 | `0.7` |
| `LLM_MAX_TOKENS` | 最大输出 token | `24000` |

## 许可证

MIT License
