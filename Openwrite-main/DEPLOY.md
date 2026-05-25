# OpenWrite 部署与集成指南

## 项目简介

OpenWrite 是一个 AI 辅助长篇小说创作引擎，通过 Agent 自动完成大纲规划、章节写作、风格控制、事实一致性检查等工作。

本项目是一个**全栈 Web 应用**，包含：
- **前端**：React + TypeScript SPA（单页应用）
- **后端**：Python FastAPI 服务
- **核心引擎**：tools/ 目录下的 Agent 和工具系统

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 前端 | React 18 + TypeScript + Vite | SPA，构建后为静态文件 |
| 后端 | Python 3.10+ + FastAPI + Uvicorn | API 服务 + WebSocket |
| LLM | OpenAI 兼容接口 | 支持 OpenAI、MiMo、SiliconFlow 等 |
| 数据 | 文件系统 (YAML/Markdown) | 无数据库，所有数据以文件形式存储 |

## 目录结构

```
openwrite/
├── server/                    # FastAPI 后端
│   ├── main.py               # 应用入口，CORS、路由注册、静态文件托管
│   ├── config.py             # 服务器配置
│   ├── dependencies.py       # DI 依赖注入
│   ├── routers/              # API 路由
│   │   ├── novels.py         # 小说列表/配置
│   │   ├── chapters.py       # 章节 CRUD + 写作/审查
│   │   ├── outline.py        # 大纲 CRUD
│   │   ├── characters.py     # 角色 CRUD
│   │   ├── world.py          # 世界设定
│   │   ├── truth_files.py    # 真相文件
│   │   ├── foreshadowing.py  # 伏笔管理
│   │   ├── style.py          # 风格系统
│   │   ├── workflow.py       # 工作流状态
│   │   ├── agents.py         # Agent 会话管理
│   │   ├── sync.py           # 同步
│   │   ├── status.py         # 状态总览
│   │   ├── llm_config.py     # LLM 配置
│   │   └── websocket.py      # WebSocket 聊天 + 进度推送
│   ├── services/             # 业务服务层
│   └── models/               # Pydantic 请求/响应模型
│
├── tools/                     # 核心引擎 (CLI + Agent)
│   ├── cli.py                # CLI 入口 + 22 个工具执行器
│   ├── agent/
│   │   ├── dante.py          # Dante Agent (写作)
│   │   └── react.py          # ReAct Agent (通用推理)
│   ├── goethe.py             # Goethe Agent (规划)
│   ├── llm/
│   │   └── client.py         # LLM 客户端 (OpenAI/Anthropic/自定义)
│   ├── foreshadowing_manager.py
│   ├── style_system.py
│   └── ...
│
├── frontend/                  # 前端源码 (开发时)
│   ├── src/
│   │   ├── pages/            # 页面组件
│   │   ├── components/       # 通用组件
│   │   ├── hooks/            # 自定义 hooks
│   │   ├── store/            # Zustand 状态管理
│   │   ├── api/              # API 客户端
│   │   └── types/            # TypeScript 类型
│   ├── package.json
│   └── vite.config.ts
│
├── static/                    # 前端构建产物 (npm run build)
│   ├── index.html
│   └── assets/
│       ├── index-xxx.js
│       └── index-xxx.css
│
├── data/                      # 小说数据目录
│   └── novels/
│       └── {novel_id}/
│           ├── src/           # 源文件 (大纲、章节草稿)
│           ├── data/          # 运行时数据 (真相文件、风格)
│           └── novel_config.yaml
│
├── .env                       # 环境变量 (API 密钥等)
├── requirements.txt           # Python 依赖
├── pyproject.toml             # Python 项目配置
└── novel_config.yaml          # 当前项目配置
```

## API 端点

### REST API (`/api`)

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/novels` | GET | 列出所有小说 |
| `/api/novels/{id}/status` | GET | 获取状态总览 |
| `/api/novels/{id}/chapters` | GET | 章节列表 |
| `/api/novels/{id}/chapters/{ch}` | GET | 章节内容 |
| `/api/novels/{id}/chapters/{ch}/write` | POST | 写章 (长时间任务) |
| `/api/novels/{id}/chapters/{ch}/review` | POST | 审查章节 |
| `/api/novels/{id}/outline` | GET | 获取大纲 |
| `/api/novels/{id}/characters` | GET/POST | 角色 CRUD |
| `/api/novels/{id}/characters/{name}` | DELETE | 删除角色 |
| `/api/novels/{id}/world/entities` | GET | 世界实体 |
| `/api/novels/{id}/world/relations` | GET | 世界关系 |
| `/api/novels/{id}/truth` | GET | 真相文件 |
| `/api/novels/{id}/foreshadowing` | GET/POST | 伏笔 CRUD |
| `/api/novels/{id}/foreshadowing/{id}` | DELETE | 删除伏笔 |
| `/api/novels/{id}/style` | GET | 风格系统 |
| `/api/novels/{id}/workflow` | GET | 工作流状态 |
| `/api/llm-config` | GET/PUT | LLM 配置 |
| `/health` | GET | 健康检查 |

### WebSocket

| 端点 | 功能 |
|------|------|
| `/ws/chat/{agent_type}?novel_id=X` | Dante/Goethe 聊天 |
| `/ws/progress/{task_id}` | 长任务进度推送 |

**聊天消息协议 (服务端 → 客户端)：**
```json
{"type": "system", "content": "..."}
{"type": "text_delta", "content": "..."}
{"type": "tool_call", "id": "...", "name": "...", "args": {...}}
{"type": "tool_result", "name": "...", "result": {...}}
{"type": "message_complete", "content": "..."}
{"type": "turn_saved", "turns": N}
{"type": "state_info", "stage": "...", "current_arc": "...", "current_chapter": "...", "pending_confirmation": "..."}
{"type": "error", "message": "..."}
{"type": "cancelled"}
```

**客户端 → 服务端：**
```json
{"type": "user_message", "content": "..."}
{"type": "cancel"}
```

## 环境变量 (.env)

```env
LLM_PROVIDER=openai           # openai | anthropic | custom
LLM_API_KEY=sk-xxx            # API 密钥
LLM_BASE_URL=https://api.openai.com/v1  # API 地址
LLM_MODEL=gpt-4o              # 模型名称
LLM_TEMPERATURE=0.7           # 温度
LLM_MAX_TOKENS=131072         # 最大 token 数
LLM_STREAM=true               # 是否流式输出
LLM_API_FORMAT=chat           # chat | responses
LLM_TIMEOUT_SECONDS=120.0     # 超时
LLM_MAX_RETRIES=3             # 重试次数
```

## 部署方式

### 方式一：宝塔 Python 项目管理器 (推荐)

1. **上传项目**到服务器，例如 `/www/wwwroot/openwrite/`

2. **安装依赖**：
   ```bash
   cd /www/wwwroot/openwrite
   pip install -r requirements.txt
   ```

3. **配置 .env**：填入你的 LLM API 密钥

4. **宝塔面板** → 软件商店 → Python 项目管理器 → 添加项目：
   - 项目路径：`/www/wwwroot/openwrite`
   - 启动文件：`server.main:app`
   - 启动方式：`uvicorn`
   - 端口：`8000`
   - Python 版本：3.10+

5. **添加 Nginx 反向代理**：
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:8000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       
       # WebSocket 支持
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_read_timeout 86400;
   }
   ```

### 方式二：Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
docker build -t openwrite .
docker run -d -p 8000:8000 -v /path/to/data:/app/data openwrite
```

### 方式三：Systemd 服务

```ini
# /etc/systemd/system/openwrite.service
[Unit]
Description=OpenWrite Server
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/www/wwwroot/openwrite
ExecStart=/usr/bin/python3 -m uvicorn server.main:app --host 127.0.0.1 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

## 作为子项目集成

如果要将 OpenWrite 作为现有网站的子项目（例如 `https://yoursite.com/novel/`）：

### 1. 修改前端 base path

编辑 `frontend/vite.config.ts`：
```typescript
export default defineConfig({
  base: '/novel/',  // 添加这行
  // ...
})
```

然后重新构建：
```bash
cd frontend && npm run build
# 复制 dist 到 static
cp -r dist ../static
```

### 2. 修改 Nginx 配置

```nginx
# 主站
location / {
    # 你的主站配置
}

# OpenWrite 子项目
location /novel/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # WebSocket
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

### 3. 修改前端 WebSocket 连接地址

编辑 `frontend/src/hooks/useChatWebSocket.ts`，修改 WebSocket URL：
```typescript
// 修改前
const url = `${protocol}//${host}/ws/chat/${agentType}?novel_id=${currentNovelId || 'current'}`

// 修改后 (加上子路径前缀)
const url = `${protocol}//${host}/novel/ws/chat/${agentType}?novel_id=${currentNovelId || 'current'}`
```

重新构建前端。

## 开发模式

```bash
# 终端1：启动后端
python -m uvicorn server.main:app --reload --port 8000

# 终端2：启动前端
cd frontend && npm run dev
```

前端开发服务器 (5173) 会自动代理 API 请求到后端 (8000)。

## 数据备份

所有小说数据存储在 `data/novels/` 目录下，备份整个 `data/` 目录即可。

## 常见问题

**Q: 前端显示空白页面？**
A: 检查 `static/` 目录是否存在。如果没有，运行 `cd frontend && npm run build` 然后 `cp -r dist ../static`。

**Q: WebSocket 连接失败？**
A: 确保 Nginx 配置了 WebSocket 支持（`proxy_set_header Upgrade` 等）。

**Q: LLM API 调用失败？**
A: 检查 `.env` 文件中的 API 密钥和 Base URL 是否正确。MiMo 用户需要设置 `LLM_MAX_TOKENS=131072`。

**Q: 宝塔部署后 502 错误？**
A: 检查 Python 项目管理器中的服务是否正常运行，查看日志排查问题。
