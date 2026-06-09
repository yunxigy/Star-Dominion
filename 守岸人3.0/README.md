# 守岸人 3.0 — AI 角色对话与互动剧情平台

一个基于 FastAPI + 原生前端的 AI 角色陪伴平台，支持角色对话、互动剧情、多人群聊、实时语音、角色羁绊等功能。

---

## ✨ 功能一览

| 功能 | 说明 |
|------|------|
| 🎭 角色对话 | 多角色支持、独立人设、音色配置、TTS语音 |
| 📖 互动剧情 | 分支选项、自定义主角、收藏评分、分享导出 |
| 💬 多角色群聊 | 多角色同时对话、@提及、发言顺序策略 |
| 🎙️ 语音陪伴 | WebSocket实时语音、VAD检测、打断机制 |
| 🧠 记忆系统 | 自动提取用户信息、手动编辑、注入对话 |
| 📚 世界书 | 关键词触发、正则匹配、优先级排序 |
| 💫 角色羁绊 | 亲密度、等级系统、对话/语音统计 |
| ⚙️ 后台管理 | 用户管理、内容审核、系统监控、数据备份 |

---

## 🛠️ 技术栈

| 模块 | 技术 |
|------|------|
| 后端 | Python 3.10+ / FastAPI / Uvicorn |
| 前端 | 原生 HTML/CSS/JS（玻璃拟态UI） |
| 数据库 | SQLite（可选 PostgreSQL） |
| LLM | OpenAI 兼容 API（小米MiMo、DeepSeek等） |
| TTS | MiMo-V2.5-TTS（云端） |
| STT | faster-whisper（本地） |
| 认证 | JWT |

---

## 📁 项目结构

```
守岸人3.0/
├── server/                     # 后端
│   ├── main.py                 # FastAPI入口
│   ├── database.py             # 数据库配置
│   ├── routers/                # API路由
│   │   ├── auth.py             # 认证（注册/登录）
│   │   ├── chat.py             # 单角色对话
│   │   ├── characters.py       # 角色管理
│   │   ├── story.py            # 互动剧情
│   │   ├── group_chat.py       # 多人群聊
│   │   ├── voice_chat.py       # 语音陪伴
│   │   ├── lorebook.py         # 世界书
│   │   ├── memory.py           # 记忆系统
│   │   ├── affinity.py         # 角色羁绊
│   │   ├── admin.py            # 后台管理
│   │   └── settings.py         # 设置
│   ├── services/               # 业务服务
│   │   ├── llm_service.py      # LLM（超时/重试/fallback）
│   │   ├── tts_service.py      # TTS
│   │   └── stt_service.py      # STT
│   └── models/                 # 数据模型
│       ├── user.py
│       ├── character_db.py
│       ├── chat_db.py
│       ├── story.py
│       ├── group_chat_db.py
│       ├── voice_session.py
│       ├── lorebook.py
│       ├── memory.py
│       └── affinity.py
├── frontend/                   # 前端页面
│   ├── index.html              # 首页（角色对话）
│   ├── login.html              # 登录
│   ├── register.html           # 注册
│   ├── characters.html         # 角色库
│   ├── stories.html            # 互动剧情
│   ├── story-play.html         # 剧情进行中
│   ├── group-chat.html         # 多人群聊
│   ├── voice-chat.html         # 语音陪伴
│   ├── memory.html             # 记忆中心
│   ├── admin.html              # 后台管理
│   ├── css/main.css            # 样式
│   ├── js/
│   │   ├── app.js              # 主逻辑
│   │   ├── auth.js             # 认证模块
│   │   ├── api.js              # API模块
│   │   ├── storage.js          # 存储模块
│   │   └── toast.js            # 提示模块
│   └── static/                 # 静态资源
│       ├── bg.mp4              # 视频背景
│       ├── 漂泊的终点.mp3       # 背景音乐
│       └── 守岸人头像.jpg       # 头像
└── data/
    ├── config.yaml             # 配置文件
    ├── app.db                  # SQLite数据库
    ├── characters/             # 角色卡
    ├── chats/                  # 对话历史
    ├── voices/                 # 语音文件
    └── audio_cache/            # TTS缓存
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd 守岸人3.0
pip install -r server/requirements.txt
```

### 2. 配置 API Key

编辑 `data/config.yaml`，填入你的 API Key：

```yaml
llm:
  default_backend: xiaomi
  backends:
    xiaomi:
      api_key: '你的API-Key'
      base_url: https://token-plan-cn.xiaomimimo.com/v1
      model: mimo-v2.5-pro
```

### 3. 启动

```bash
python -m server.main
```

浏览器打开 `http://127.0.0.1:8000`

### 4. 默认管理员

- 用户名：`admin`
- 密码：`admin123`

---

## 📄 许可证

MIT
