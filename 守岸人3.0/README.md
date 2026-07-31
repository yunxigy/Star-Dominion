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
| 🌿 分支对话 | 消息编辑、非破坏式删除、左右滑动、重新生成、分支切换 |
| 📍 检查点 | 保存当前节点，随时恢复为新的安全分支 |
| 🔎 对话搜索 | 按当前用户搜索消息正文和所有 swipe 候选 |
| 💾 对话备份 | 活动路径 JSONL、完整分支图 JSON、自动保留最近 20 份快照 |
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

### 账号与本地资料

`site-auth` 是密码、登录会话、角色权限和 CSRF 校验的唯一来源。守岸人不会复制或校验统一账号的密码；它只在本地 `users` 表保存一条通过 `site_user_id` 绑定的影子资料，用于兼容角色、聊天和记忆数据的既有外键。

首次使用统一账号访问守岸人时，系统会按以下顺序处理本地资料：

1. 优先读取已绑定相同 `site_user_id` 的资料。
2. 未绑定时按用户名或邮箱绑定旧资料，保留旧资料主键和历史聊天。
3. 没有旧资料时创建不可本地登录的影子资料。
4. 用户名和邮箱分别命中不同旧资料时返回 `409`，不会自动合并数据。

修改 `.env.local` 中的测试密码不会修改账号密码。密码创建与重置仍使用根目录 `site-auth` 管理命令。

## 分支聊天与备份

编辑消息或“删除后续”不会物理删除原消息，而是从目标位置创建新分支。分支选择器可以返回原路径；检查点恢复也会创建新分支，因此恢复操作不会截断原分支。

每次编辑、删除、切换分支以及创建、恢复或删除检查点后，服务会在 `data/chat_backups/` 写入完整图快照。每个会话最多保留最近 20 份，临时文件写完后才原子替换为正式 JSON。

两种导出格式用途不同：

| 格式 | 内容 | 适用场景 |
|------|------|----------|
| JSONL | 当前活动路径、消息正文、swipes、选中项和时间 | 阅读、迁移到兼容聊天工具 |
| 完整备份 JSON | 会话、所有分支、所有消息、检查点和头指针 | 守岸人内完整恢复 |

完整备份文件最大 10 MiB、最多 20,000 条消息。导入会先验证引用完整性和父指针无环，再在单事务中重写所有 ID。备份目录、本地数据库、日志、Cookie 和 API Key 都不应提交到 Git。

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
    ├── chat_backups/        # 自动完整图快照（不提交）
    ├── characters/          # 角色卡
    └── voices/              # 语音文件
```

## 许可证

MIT License
