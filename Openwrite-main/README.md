# OpenWrite

AI 驱动的长篇小说创作平台 — Web 端 + CLI 双模式。

<p align="center">
  <img src="https://img.shields.io/badge/version-5.4.0-2563eb" alt="Version">
  <img src="https://img.shields.io/badge/python-%3E%3D3.11-22c55e?logo=python" alt="Python >= 3.11">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
</p>

---

## 简介

OpenWrite 是一个面向长篇小说创作的 AI 平台。从灵感整理、人物设定、大纲规划，到章节写作、审查校对、风格合成，全部在同一条工作流里完成。

核心理念：**长篇小说不是一次性 prompt，而是一场持续数月的协作。**

## 功能一览

| 功能 | 说明 |
|------|------|
| **AI 对话** | Dante（写作）和 Goethe（规划）双 Agent |
| **自动写作** | 设定目标字数后 AI 自动推进多章节 |
| **章节管理** | 写入、审查、删除、版本历史、Diff 对比 |
| **大纲管理** | 可视化编辑，AI 自动生成新章节大纲 |
| **角色管理** | 角色卡片、关系图可视化 |
| **世界设定** | 世界观实体、关系、真相文件 |
| **伏笔管理** | DAG 图结构，状态追踪 |
| **风格系统** | 从参考文本提取风格，合成风格文档 |
| **工作流** | 章节级阶段推进（写→审→改→定） |
| **导出** | EPUB / PDF 一键导出 |
| **统计** | 字数趋势、写作速度、连续天数 |
| **搜索** | 全文搜索（章节/角色/大纲/真相） |
| **工具箱** | 真相验证、来源管理、市场分析、创建小说 |

## 技术架构

```
Openwrite-main/
├── server/                     # FastAPI 后端
│   ├── main.py                 # 入口
│   ├── config.py               # 配置
│   ├── routers/                # 15 个路由模块
│   ├── services/               # 工具执行器服务
│   └── models/                 # 请求/响应模型
├── tools/                      # Python 工具层
│   ├── cli.py                  # CLI 入口 + 27 个工具 executor
│   ├── export.py               # EPUB/PDF 导出
│   ├── writing_stats.py        # 写作统计
│   ├── search.py               # 全局搜索
│   ├── character_graph.py      # 角色关系图
│   ├── chapter_history.py      # 版本历史
│   ├── auto_writer.py          # 自动写作引擎
│   ├── agent/                  # Dante/Goethe Agent
│   └── llm/                    # LLM 客户端
├── frontend/                   # React 前端
│   ├── src/pages/              # 18 个页面
│   ├── src/components/         # 布局 + 通用组件
│   ├── src/store/              # Zustand 状态管理
│   └── src/api/                # API 封装
├── data/novels/{novel_id}/     # 小说数据
│   ├── src/                    # 真源（大纲、角色、设定）
│   └── data/                   # 运行态（手稿、工作流、缓存）
└── start.py                    # 启动脚本
```

## 快速开始

### 安装

```bash
pip install -r requirements.txt
cd frontend && npm install
```

### 配置

创建 `.env` 文件：

```env
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

支持任何兼容 OpenAI API 格式的模型服务。

### 启动

```bash
# 后端（端口 8001）
python start.py

# 前端（端口 5174）
cd frontend && npm run dev
```

访问 `http://localhost:5174/openwrite/`

### CLI 使用

```bash
python -m tools.cli goethe    # 规划入口
python -m tools.cli dante     # 创作入口
python -m tools.cli status    # 查看状态
python -m tools.cli write ch_005  # 写指定章节
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | 模型 API Key | 无 |
| `LLM_PROVIDER` | 提供商 | `openai` |
| `LLM_MODEL` | 模型名 | `gpt-4o-mini` |
| `LLM_BASE_URL` | API 地址 | `https://api.openai.com/v1` |
| `LLM_TEMPERATURE` | 温度 | `0.7` |
| `LLM_MAX_TOKENS` | 最大输出 | `24000` |
| `LLM_TIMEOUT_SECONDS` | 超时秒数 | `300` |
| `OPENWRITE_PORT` | 后端端口 | `8001` |

## 许可证

MIT License
