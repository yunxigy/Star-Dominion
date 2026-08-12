# Star Dominion

综合性 Web 平台，集成在线工具箱、AI 写作、AI 角色陪伴和 A 股主板研究模块。

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite" alt="Vite 8">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/Python-3.11-3776AB?logo=python" alt="Python 3.11">
</p>

---

## 平台架构

```
Star Dominion
├── SD/                 # 在线工具箱（128+ 工具，端口 5173）
├── Openwrite-main/     # AI 写作平台（端口 8001 + 5174）
├── 守岸人3.0/           # AI 角色陪伴（端口 8000）
└── stock-module/       # 股票研究子模块（端口 8002/8003/8004 + 5175）
```

三个模块通过 SD 主站统一入口访问：

| 入口 | 路由 | 说明 |
|------|------|------|
| SD 工具箱 | `http://localhost:5173` | 主站，工具箱 + 导航入口 |
| 网文智能体 | `http://localhost:5173/ai` | iframe 嵌入 Openwrite |
| AI 伴侣 | `http://localhost:5173/wuwa` | 新窗口打开守岸人 |
| 股票研究 | `http://localhost:5175/stock/`（本地联调） | A 股主板候选、个股 AI 分析与独立宝妈指数入口 |

---

## 模块一：SD 工具箱

128+ 个免费在线工具，大部分纯前端处理，数据不出浏览器。

| 分类 | 数量 | 说明 |
|------|------|------|
| PDF 工具 | 14 | 合并、拆分、压缩、转图片、加水印、加密 |
| 图片工具 | 13 | 压缩、裁剪、改尺寸、加水印、Base64、取色器 |
| 格式转换 | 12 | JPG/PNG/WebP/SVG/BMP/HEIC/ICO 互转 |
| 开发者工具 | 20 | JSON/XML/HTML/CSS 格式化、正则测试、编码解码 |
| 计算器 | 17 | BMI、贷款、房贷、复利、单位换算 |
| 图片增强 | 10 | 清晰度增强、亮度/锐化、马赛克、表情包 |
| 测评中心 | 11 | MBTI、大五人格、九型人格、DISC |
| 塔罗星座 | 11 | 每日塔罗、星座配对、运势查询 |
| 音频处理 | 3 | 格式转换、NCM 解密、变声器 |
| 文档工具 | 5 | OCR 识别、文本翻译、论文查重 |
| 鼠标测试 | 10 | CPS 点击、反应速度、DPI 检测 |

**技术栈：** React 19 + TypeScript 5 + Vite 8 + Tailwind CSS 4

---

## 模块二：Openwrite

AI 驱动的长篇小说创作平台，Web 端 + CLI 双模式。

### 核心功能

| 功能 | 说明 |
|------|------|
| AI 对话 | Dante（写作）和 Goethe（规划）双 Agent |
| 自动写作 | 设定目标字数后 AI 自动推进，支持暂停/恢复 |
| 写+审+改 | 写完自动审查，低分自动修改，最多 2 轮 |
| 章节管理 | 写入、审查、删除、版本历史、Diff 对比 |
| 大纲管理 | 可视化编辑，AI 自动生成新章节大纲 |
| 角色管理 | 角色卡片、关系图可视化 |
| 世界设定 | 世界观实体、关系、真相文件 |
| 伏笔管理 | DAG 图结构，状态追踪 |
| 风格系统 | 从参考文本提取风格，合成风格文档 |
| 工作流 | 章节级阶段推进（写→审→改→定） |
| 导出 | EPUB / PDF 一键导出 |
| 统计 | 字数趋势、写作速度、连续天数 |
| 搜索 | 全文搜索（章节/角色/大纲/真相） |

### 架构

```
Openwrite-main/
├── server/                     # FastAPI 后端
│   ├── main.py                 # 入口
│   ├── routers/                # 15 个路由模块
│   ├── services/               # 工具执行器服务
│   └── models/                 # 请求/响应模型
├── tools/                      # Python 工具层
│   ├── cli.py                  # CLI + 28 个 executor
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
│   └── src/store/              # Zustand 状态管理
├── data/novels/{novel_id}/     # 小说数据
│   ├── src/                    # 真源（大纲、角色、设定）
│   └── data/                   # 运行态（手稿、工作流、缓存）
└── start.py                    # 启动脚本
```

### API 端点

40+ 个 REST API + 3 个 WebSocket，详见 [DEPLOY.md](DEPLOY.md)。

**技术栈：** Python 3.11 + FastAPI + React 19 + Zustand + WebSocket

---

## 模块三：守岸人 3.0

AI 角色对话与互动剧情平台。

| 功能 | 说明 |
|------|------|
| 🎭 角色对话 | 多角色支持、独立人设、音色配置、TTS 语音 |
| 📖 互动剧情 | 分支选项、自定义主角、收藏评分 |
| 💬 多角色群聊 | 多角色同时对话、@提及 |
| 🎙️ 语音陪伴 | WebSocket 实时语音、VAD 检测 |
| 🧠 记忆系统 | 自动提取用户信息、注入对话 |
| 📚 世界书 | 关键词触发、正则匹配、优先级排序 |
| 💫 角色羁绊 | 亲密度、等级系统 |
| 📤 角色卡导入导出 | 兼容 Tavern Card PNG/JSON |
| ⌨️ 斜杠命令 | `/help`、`/clear`、`/swipe` 等 |

**技术栈：** Python 3.11 + FastAPI + SQLAlchemy + 原生 HTML/CSS/JS

---

## 模块四：股票研究

仅覆盖沪深 A 股主板。模块汇总九点猫研和用户策略候选，支持页面内配置硅基流动或其他 OpenAI 兼容 API，并要求每次个股分析都明确选择配置和模型。宝妈指数保持独立，不参与候选排序。

本地采用四进程隔离：React 前端 `5175`、股票主服务 `8002`、个股分析适配器 `8003`、内部模型网关 `8004`。安装、启动、安全边界和 API 说明见 [股票研究模块 README](stock-module/README.md)。

**技术栈：** Python 3.11 + FastAPI + SQLite + React 19 + TypeScript + Vite 8

---

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| 守岸人后端 | **8000** | FastAPI + SQLite |
| Openwrite 后端 | **8001** | FastAPI + 文件系统 |
| SD 工具箱 | **5173** | Vite 开发服务器 |
| Openwrite 前端 | **5174** | Vite 开发服务器 |
| 股票研究前端 | **5175** | Vite 开发服务器 |
| 股票主服务 | **8002** | 候选、模型配置与分析任务 API |
| 个股分析适配器 | **8003** | 内部 daily_stock_analysis 适配层 |
| 内部模型网关 | **8004** | 内部签名路由与 API Key 注入 |

**代理关系（SD 主站入口）：**

```
SD (5173)
├── /api/*        → localhost:8000  (守岸人 API)
├── /ow-api/*     → localhost:8001  (Openwrite API)
├── /ws/*         → localhost:8001  (Openwrite WebSocket)
├── /openwrite/*  → localhost:5174  (Openwrite 前端)
├── /wuwa         → localhost:8000  (守岸人前端)
└── /stock-api/*  → localhost:8002  (股票研究公开 API)
```

---

## 环境要求

- **Python** >= 3.11
- **Node.js** >= 18
- **npm** >= 9

---

## 快速启动

```bash
# 1. 守岸人后端（端口 8000）
cd 守岸人3.0 && python -m server.main

# 2. Openwrite 后端（端口 8001）
cd Openwrite-main && python start.py

# 3. Openwrite 前端（端口 5174）
cd Openwrite-main/frontend && npm run dev

# 4. SD 工具箱（端口 5173）
cd SD && npm run dev

# 5. 股票研究模块
# 详见 stock-module/README.md，需要分别启动 8002、8003、8004 和 5175
```

访问：
- **SD 工具箱：** `http://localhost:5173`
- **Openwrite：** `http://localhost:5174/openwrite/`
- **守岸人：** `http://localhost:8000`
- **股票研究：** `http://localhost:5175/stock/`

---

## 依赖安装

```bash
# Openwrite 后端
cd Openwrite-main && pip install -r requirements.txt

# Openwrite 前端
cd Openwrite-main/frontend && npm install

# SD 工具箱
cd SD && npm install

# 守岸人
cd 守岸人3.0 && pip install -r server/requirements.txt
```

---

## 环境变量

### Openwrite（`.env`）

```env
LLM_PROVIDER=openai
LLM_API_KEY=你的API密钥
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=24000
LLM_TIMEOUT_SECONDS=300
OPENWRITE_PORT=8001
```

### 守岸人（`data/config.yaml`）

```yaml
server:
  host: 0.0.0.0
  port: 8000
llm:
  default_backend: xiaomi
  backends:
    xiaomi:
      api_key: '你的API密钥'
      base_url: https://token-plan-cn.xiaomimimo.com/v1
      model: mimo-v2.5-pro
```

---

## 生产部署

详见 [DEPLOY.md](DEPLOY.md)，包含：
- Nginx 反向代理配置
- SSL 证书配置
- 安全规则
- 数据目录说明
- 故障排查

---

## 项目结构

```
Star-Dominion/
├── SD/                         # 工具箱前端
│   ├── components/tools/       # 128 个工具组件
│   ├── pages/                  # 页面
│   ├── tools/registry.tsx      # 工具注册表
│   └── vite.config.ts
├── Openwrite-main/             # AI 写作平台
│   ├── server/                 # FastAPI 后端
│   ├── tools/                  # Python 工具层
│   ├── frontend/               # React 前端
│   ├── data/novels/            # 小说数据
│   └── .env                    # LLM 配置
├── 守岸人3.0/                   # AI 角色陪伴
│   ├── server/                 # FastAPI 后端
│   ├── frontend/               # 原生 HTML/JS
│   └── data/                   # 角色/对话/语音
├── stock-module/               # A 股主板研究子模块
│   ├── backend/                # 股票主服务与内部模型网关
│   ├── analysis-service/       # 个股分析隔离适配器
│   └── frontend/               # React 股票研究页面
├── DEPLOY.md                   # 部署指南
├── nginx.conf                  # Nginx 配置模板
└── README.md                   # 本文件
```

---

## 许可证

MIT License
