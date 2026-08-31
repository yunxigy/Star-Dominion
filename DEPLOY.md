# Star Dominion 云端部署指南

> 本文档供部署人员/CC 了解项目结构、端口、依赖和启动方式。

---

## 项目结构

```
Star-Dominion/
├── SD/                 # 在线工具箱（前端）
├── Openwrite-mainV2/   # AI 写作平台（Studio 前后端一体）
└── 守岸人3.0/           # AI 角色陪伴（前后端）
```

---

## 端口分配

| 服务 | 端口 | 说明 |
|------|------|------|
| site-auth 认证服务 | **8000** | FastAPI + SQLite，会话与统一登录 |
| Openwrite V2 Studio | **8001** | 页面、API 与 WebSocket 一体服务 |
| 股票研究后端 | **8002–8004** | 编排、分析适配器与模型网关 |
| 守岸人 后端 | **8006** | FastAPI + SQLite，角色对话与世界书 |
| STM32/4G | **8007–8008** | HTTP/WebSocket 与设备 TCP |
| 研报服务 | **8009** | GitHub 周榜与研报数据 |
| 文档转换中心 | **8010** | Office/PDF/Markdown 等转换 |
| 视频解析下载 | **8011** | 单个公开视频解析与临时下载 |
| 站长检测 | **8012** | 受控公开网站检测 |
| SD 工具箱 | **8013** | Vite 开发服务器 |
| 股票研究前端 | **8014** | Vite 开发服务器 |

**代理关系（通过 SD 入口）：**
- `localhost:8013/api/*` → `localhost:8006`（守岸人 API）
- `localhost:8013/openwrite/*` → `localhost:8001`（OpenWrite V2 Studio）
- `localhost:8013/ow-api/*` → `localhost:8001`（兼容 API 前缀）
- `localhost:8013/wuwa/*` → `localhost:8006`（守岸人前端）

---

## 环境要求

- **Python** >= 3.11
- **Node.js** >= 18
- **npm** >= 9
- **操作系统**：Linux (推荐 Ubuntu 22.04+) 或 Windows

---

## 依赖安装

### OpenWrite V2 Studio
```bash
cd Openwrite-mainV2
pip install -r requirements.txt
# 主要依赖: fastapi, uvicorn, pydantic, pyyaml, openai, anthropic
# 导出依赖: ebooklib, markdown, fpdf2
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

### OpenWrite V2（`.env` 文件，放在 `Openwrite-mainV2/` 根目录）

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
OPENWRITE_HOST=127.0.0.1
OPENWRITE_PORT=8001
OPENWRITE_CORS_ORIGINS=https://你的域名,http://localhost:8013,http://localhost:8014
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
# 1. 统一认证服务（端口 8000）
cd site-auth && python -m uvicorn site_auth.main:create_app --factory --host 127.0.0.1 --port 8000

# 2. OpenWrite V2 Studio（端口 8001，页面与 API）
cd Openwrite-mainV2 && python -m tools.cli studio --port 8001 --no-open

# 3. 守岸人后端（端口 8006）
cd 守岸人3.0 && python -m server.main

# 4. SD 工具箱（端口 8013）
cd SD && npm run dev

# 5. 股票研究前端（端口 8014）
cd stock-research-package/stock-module/frontend && npm run dev
```

### 生产模式

```bash
# 1. 统一认证服务（端口 8000）
cd site-auth && python -m uvicorn site_auth.main:create_app --factory --host 127.0.0.1 --port 8000

# 2. 守岸人后端（端口 8006）
cd 守岸人3.0 && python -m server.main

# 3. OpenWrite V2 Studio（页面和 API 由 8001 提供）
cd Openwrite-mainV2 && python -m tools.cli studio --port 8001 --no-open

# 4. 构建 SD 与股票前端
cd SD && npm run build
cd ../stock-research-package/stock-module/frontend && npm run build
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

    # OpenWrite V2 Studio（页面和 API 均由 8001 提供）
    location /openwrite/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Prefix /openwrite;
        proxy_read_timeout 600s;
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

    # 守岸人 API（端口 8006）
    location /api/ {
        proxy_pass http://127.0.0.1:8006;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600s;
    }

    # 守岸人 WebSocket（端口 8006，用独立前缀避免和 Openwrite 冲突）
    location /ws-shouren/ {
        rewrite ^/ws-shouren/(.*) /ws/$1 break;
        proxy_pass http://127.0.0.1:8006;
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

### 守岸人（端口 8006）

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
Openwrite-mainV2/
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
└── tools/studio_assets/    # Studio 静态资源
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
4. **全站认证不提供默认密码；部署时通过 site-auth CLI 从标准输入创建唯一管理员**
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
