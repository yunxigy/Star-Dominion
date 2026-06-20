# Star Dominion 云端部署指南

> 本文档供部署人员/CC 了解项目结构、端口、依赖和启动方式。

---

## 项目结构

```
Star-Dominion/
├── SD/                 # 在线工具箱（前端）
├── Openwrite-main/     # AI 写作平台（前后端）
└── 守岸人3.0/           # AI 角色陪伴（前后端）
```

---

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| 守岸人 后端 | **8000** | FastAPI + SQLite |
| Openwrite 后端 | **8001** | FastAPI + 文件系统 |
| SD 工具箱 | **5173** | Vite 开发服务器 |
| Openwrite 前端 | **5174** | Vite 开发服务器 |

**代理关系（通过 SD 入口）：**
- `localhost:5173/api/*` → `localhost:8000`（守岸人 API）
- `localhost:5173/openwrite/*` → `localhost:5174`（Openwrite 前端）
- `localhost:5173/ow-api/*` → `localhost:8001`（Openwrite API）
- `localhost:5173/wuwa/*` → `localhost:8000`（守岸人前端）

---

## 环境要求

- **Python** >= 3.11
- **Node.js** >= 18
- **npm** >= 9
- **操作系统**：Linux (推荐 Ubuntu 22.04+) 或 Windows

---

## 依赖安装

### Openwrite 后端
```bash
cd Openwrite-main
pip install -r requirements.txt
# 主要依赖: fastapi, uvicorn, pydantic, pyyaml, openai, anthropic
# 导出依赖: ebooklib, markdown, fpdf2
```

### Openwrite 前端
```bash
cd Openwrite-main/frontend
npm install
```

### SD 工具箱
```bash
cd SD
npm install
```

### 守岸人
```bash
cd 守岸人3.0
pip install -r server/requirements.txt
# 主要依赖: fastapi, sqlalchemy, uvicorn, pyyaml
```

---

## 环境变量

### Openwrite（`.env` 文件，放在 `Openwrite-main/` 根目录）

```env
LLM_PROVIDER=openai
LLM_API_KEY=你的API密钥
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=24000
LLM_STREAM=true
LLM_API_FORMAT=chat
LLM_TIMEOUT_SECONDS=300
LLM_MAX_RETRIES=3
OPENWRITE_HOST=0.0.0.0
OPENWRITE_PORT=8001
OPENWRITE_CORS_ORIGINS=https://你的域名,http://localhost:5173,http://localhost:5174
```

### 守岸人（`data/config.yaml`，放在 `守岸人3.0/` 根目录）

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
    deepseek:
      api_key: '你的API密钥'
      base_url: https://api.deepseek.com/v1
      model: deepseek-chat
```

---

## 启动命令

### 开发模式

```bash
# 1. 守岸人后端 (端口 8000)
cd 守岸人3.0 && python -m server.main

# 2. Openwrite 后端 (端口 8001)
cd Openwrite-main && python start.py

# 3. Openwrite 前端 (端口 5174)
cd Openwrite-main/frontend && npm run dev

# 4. SD 工具箱 (端口 5173)
cd SD && npm run dev
```

### 生产模式

```bash
# 1. 守岸人后端
cd 守岸人3.0 && python -m server.main

# 2. Openwrite 后端
cd Openwrite-main && python start.py

# 3. 构建前端
cd Openwrite-main/frontend && npm run build
# 产物在 dist/，复制到 Openwrite-main/static/
cp -r dist ../static

# 4. 构建 SD
cd SD && npm run build
# 产物在 dist/，用 nginx 托管
```

---

## 生产部署（Nginx 反向代理）

```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name your-domain.com;

    # SSL 配置（按你的证书路径填写）
    ssl_certificate    /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # SD 工具箱（静态文件）
    location / {
        root /path/to/SD/dist;
        try_files $uri $uri/ /index.html;
    }

    # Openwrite 前端（静态文件）
    location /openwrite/ {
        alias /path/to/Openwrite-main/static/;
        try_files $uri $uri/ /openwrite/index.html;
    }

    # Openwrite API（端口 8001）
    location /ow-api/ {
        rewrite ^/ow-api/(.*) /api/$1 break;
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600s;
    }

    # Openwrite WebSocket（端口 8001）
    location /ws/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # 守岸人 API（端口 8000）
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600s;
    }

    # 守岸人 WebSocket（端口 8000，用独立前缀避免和 Openwrite 冲突）
    location /ws-shouren/ {
        rewrite ^/ws-shouren/(.*) /ws/$1 break;
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

---

## API 端点清单

### Openwrite（端口 8001，共 40+ 个）

| 类别 | 端点 | 方法 |
|------|------|------|
| 小说管理 | `/api/novels` | GET |
| | `/api/novels/{id}/config` | GET/PUT |
| | `/api/novels/{id}/status` | GET |
| | `/api/novels/{id}/doctor` | POST |
| | `/api/novels/init` | POST |
| | `/api/novels/{id}` | DELETE |
| 章节 | `/api/novels/{id}/chapters` | GET |
| | `/api/novels/{id}/chapters/{cid}` | GET/DELETE |
| | `/api/novels/{id}/chapters/{cid}/write` | POST |
| | `/api/novels/{id}/chapters/{cid}/review` | POST |
| | `/api/novels/{id}/chapters/{cid}/assemble` | POST |
| | `/api/novels/{id}/chapters/{cid}/context` | GET |
| | `/api/novels/{id}/chapters/{cid}/history` | GET |
| | `/api/novels/{id}/chapters/{cid}/diff` | GET |
| | `/api/novels/{id}/chapters/write-and-review` | POST |
| 大纲 | `/api/novels/{id}/outline` | GET/PUT |
| | `/api/novels/{id}/outline/hierarchy` | GET |
| 角色 | `/api/novels/{id}/characters` | GET/POST |
| | `/api/novels/{id}/characters/{name}` | GET/PUT/DELETE |
| 世界观 | `/api/novels/{id}/world/entities` | GET |
| | `/api/novels/{id}/world/entities/{eid}` | GET |
| | `/api/novels/{id}/world/relations` | GET |
| 真相文件 | `/api/novels/{id}/truth` | GET |
| | `/api/novels/{id}/truth/{fname}` | PUT |
| 伏笔 | `/api/novels/{id}/foreshadowing` | GET/POST |
| | `/api/novels/{id}/foreshadowing/{nid}` | PUT/DELETE |
| | `/api/novels/{id}/foreshadowing/validate` | POST |
| 风格 | `/api/novels/{id}/style` | GET |
| | `/api/novels/{id}/style/extract` | POST |
| | `/api/novels/{id}/style/synthesize` | POST |
| 工作流 | `/api/novels/{id}/workflow` | GET |
| | `/api/novels/{id}/workflow/{cid}/start` | POST |
| | `/api/novels/{id}/workflow/{cid}/advance` | POST |
| 同步 | `/api/novels/{id}/sync` | GET/POST |
| 验证 | `/api/novels/{id}/validate/truth` | POST |
| | `/api/novels/{id}/validate/post-write` | POST |
| 搜索 | `/api/novels/{id}/search?q=关键词` | GET |
| 统计 | `/api/novels/{id}/stats` | GET |
| 导出 | `/api/novels/{id}/export/epub` | GET |
| | `/api/novels/{id}/export/pdf` | GET |
| | `/api/novels/{id}/export/chapters` | GET |
| 关系图 | `/api/novels/{id}/graph/characters` | GET |
| 来源 | `/api/novels/{id}/sources` | GET |
| | `/api/novels/{id}/sources/{sid}/promote` | POST |
| 雷达 | `/api/novels/{id}/radar` | POST |
| LLM | `/api/llm-config` | GET/PUT |
| Agent | `/api/novels/{id}/agents/{type}/session` | GET/DELETE |
| WebSocket | `/ws/chat/{agent_type}` | WS |
| | `/ws/auto-write` | WS |
| | `/ws/progress/{task_id}` | WS |

### 守岸人（端口 8000）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/auth/login` | POST | 登录 |
| `/api/auth/register` | POST | 注册 |
| `/api/chat` | POST | 对话 |
| `/api/characters` | GET/POST | 角色管理 |
| `/api/stories` | GET/POST | 互动剧情 |
| `/api/group-chat` | GET/POST | 多人群聊 |
| `/api/voice-chat` | WS | 语音陪伴 |
| `/api/lorebook` | GET/POST | 世界书 |
| `/api/memory` | GET/POST | 记忆系统 |
| `/api/affinity` | GET | 角色羁绊 |

---

## 数据目录

### Openwrite
```
Openwrite-main/
├── .env                    # LLM 配置（不提交）
├── novel_config.yaml       # 全局小说配置
├── data/
│   ├── novels/
│   │   ├── {novel_id}/
│   │   │   ├── src/        # 真源（大纲、角色、设定）
│   │   │   ├── data/       # 运行态（手稿、工作流、缓存）
│   │   │   └── novel_config.yaml  # 小说独立配置（可选）
│   │   └── ...
│   └── trash/              # 回收站
└── frontend/
    └── src/                # 前端源码
```

### 守岸人
```
守岸人3.0/
├── data/
│   ├── config.yaml         # 配置（含 API Key，不提交）
│   ├── app.db              # SQLite 数据库
│   ├── characters/         # 角色卡
│   ├── chats/              # 对话历史
│   ├── voices/             # 语音文件
│   └── audio_cache/        # TTS 缓存
└── frontend/               # 原生 HTML/CSS/JS
```

---

## 安全注意事项

1. **`.env` 和 `config.yaml` 包含 API Key，不要提交到 Git**
2. **`.gitignore` 已排除敏感文件，确认生效**
3. **生产环境 CORS 不要用 `*`，指定具体域名**
4. **守岸人默认管理员 admin/admin123，部署后立即修改**
5. **SQLite 不适合高并发，如需扩展改用 PostgreSQL**

---

## 故障排查

| 问题 | 检查 |
|------|------|
| 端口冲突 | `netstat -ano \| grep 端口号` |
| API 401 | 检查 `.env` 中的 `LLM_API_KEY` |
| 前端白屏 | 检查 vite proxy 配置和后端端口 |
| WebSocket 断连 | 检查 nginx proxy_read_timeout |
| 导出失败 | 确认 `ebooklib`、`fpdf2` 已安装 |
| 守岸人启动报错 | 检查 `data/config.yaml` 格式 |

---

## 当前版本

| 组件 | 版本 |
|------|------|
| Openwrite | v5.4.0 |
| 守岸人 | v3.0.0 |
| SD 工具箱 | v1.2.0 |
| Python | >= 3.11 |
| Node.js | >= 18 |
