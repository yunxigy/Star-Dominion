# 守岸人 3.0

AI 角色对话与互动剧情平台。

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11-3776AB?logo=python" alt="Python 3.11">
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite" alt="SQLite">
</p>

---

## 功能

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

## 技术栈

| 模块 | 技术 |
|------|------|
| 后端 | Python 3.11 / FastAPI / SQLAlchemy |
| 前端 | 原生 HTML/CSS/JS |
| 数据库 | SQLite |
| LLM | 小米 MiMo、DeepSeek、OpenAI、Claude、Gemini |
| TTS | MiMo-V2.5-TTS（预置音色/音色克隆） |
| STT | Whisper（本地识别） |

## 快速开始

```bash
# 安装依赖
pip install -r server/requirements.txt

# 启动
python -m server.main
```

浏览器打开 `http://127.0.0.1:8006`

### 配置

编辑 `data/config.yaml`，填入 API Key：

```yaml
llm:
  default_backend: xiaomi
  backends:
    xiaomi:
      api_key: '你的API-Key'
      base_url: https://token-plan-cn.xiaomimimo.com/v1
      model: mimo-v2.5-pro
```

登录由根目录 `site-auth` 统一提供。注册入口已关闭，请使用
`site-auth-admin create-admin` 创建唯一管理员；项目不再提供默认账号或密码。

## 项目结构

```
守岸人3.0/
├── server/
│   ├── main.py              # FastAPI 入口
│   ├── config.py            # 配置
│   ├── database.py          # 数据库
│   ├── routers/             # API 路由
│   ├── services/            # LLM/TTS/STT 服务
│   └── models/              # 数据模型
├── frontend/                # 前端页面
│   ├── index.html           # 首页
│   ├── css/main.css         # 样式
│   └── js/                  # JS 模块
└── data/
    ├── config.yaml          # 配置
    ├── app.db               # 数据库
    ├── characters/          # 角色卡
    └── voices/              # 语音文件
```

## 许可证

MIT License
