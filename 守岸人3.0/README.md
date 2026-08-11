# 守岸人 3.0

## 高级世界书

世界书触发由独立的纯规则引擎执行，支持主/次关键词 AND、OR，大小写与全词匹配、正则、常驻条目、概率、delay、sticky、cooldown、递归、互斥分组、三种 Prompt 位置和 Token 预算。管理页面为 `/lorebooks.html?character_id=<角色ID>`，调试器只返回触发 trace，不写入时效事件。

世界书默认随所属角色生效，也可关闭“角色默认生效”后绑定到指定聊天。时效状态按活动分支上的用户回合计算并绑定到助手回复；切换分支会自然继承或丢弃对应状态，重新生成 Swipe 不推进回合，也不会续期 sticky。数据库 schema 版本为 4，旧库启动时执行增量迁移。

本实现依据项目需求 clean-room 开发，不复制或改编 SillyTavern 的 AGPL 源码、测试、文案、资产或界面。Persona、Prompt Manager 及其页面均为独立实现；所有 Persona、绑定、预设和模型资料均按统一站点用户隔离，API 不允许读写其他用户的记录。

## Persona 与 Prompt Manager

Persona 用于描述当前对话中的用户身份，与角色自身设定分开管理。选择顺序固定为：

1. 当前请求通过 `persona_id` 指定的临时 Persona。
2. 当前聊天绑定的 Persona。
3. 当前角色绑定的 Persona。
4. 当前用户的默认 Persona。

临时 Persona 只影响本次请求，不会覆盖聊天、角色或默认绑定。Persona 可配置在角色设定前、角色设定后或指定历史深度注入；普通回复、重新生成和 Swipe 共用相同的选择规则。管理页面为 `/personas.html`。

Prompt Manager 将可配置内容保存为有序块，支持 `system`、`character`、`persona`、`lorebook`、`memory`、`rag`、`author_note`、`history` 和 `final` 九种类型。块可以启停、编辑、排序并设置单块 Token 上限；预设还可以设置总 Token 预算。模型资料只保存 provider、model、生成参数和预设引用，不保存或复制 API Key。

预览接口只返回按顺序组成的文本、Token 估算和纳入/跳过原因，并仅允许展示 provider、model、temperature、top_p、max_tokens 和停止序列名称等安全元数据。API Key、Cookie、Authorization 及其他密钥形态字段不会进入预览。管理页面为 `/prompt-manager.html`。

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
| 👤 Persona | 私有 Persona、默认项、角色/聊天绑定和临时选择 |
| 🧩 Prompt Manager | Prompt 块排序、预算、安全预览和模型资料 |
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
│   ├── personas.html        # Persona 管理
│   ├── prompt-manager.html  # Prompt Manager
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
