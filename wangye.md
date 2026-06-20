# 整体项目静态审计报告

审计范围：

- `守岸人3.0/`：FastAPI 后端 + 原生 JS 前端，包含聊天、角色、剧情、群聊、语音聊天、长期记忆、设置、后台管理等模块。
- `Openwrite-main/`：OpenWrite 长篇小说创作引擎，包含 FastAPI 服务、CLI/工具链、LLM 写作相关模块。
- `SD/`：React + Vite 前端工具箱项目，包含工具注册表、工具窗口、PDF/图片/转换/测试等模块。

验证记录：

- `守岸人3.0/server`：`python -m compileall server` 通过。
- `守岸人3.0/server`：后端 Python 文件 `ast.parse` 全量通过。
- `守岸人3.0/frontend/js/app.js/api.js/auth.js`：`node --check` 通过。
- `Openwrite-main`：全 Python 文件 `ast.parse` 通过。
- `Openwrite-main`：`import server.main.app` 通过。
- `SD`：`npm run validate` 通过，工具注册表无重复 ID、分类/图标/颜色错误。
- `SD`：`npm run build` 当前失败，错误为 Vite HTML inline CSS proxy 加载失败。

---

## 一、`守岸人3.0` 高优先级 bug

### 1. 语音聊天 WebSocket 必败：前端没有传 ticket

**影响**：语音聊天页面无法建立 WebSocket，连接后后端会返回 `无效的ticket`。

**证据**：

- 后端明确要求 query 参数 `ticket`：[`server/routers/voice_chat.py:152`](守岸人3.0/server/routers/voice_chat.py:152)
- 后端 ticket 接口：[`server/routers/voice_chat.py:136`](守岸人3.0/server/routers/voice_chat.py:136)
- 前端连接 URL 未拼接 ticket：[`frontend/voice-chat.html:521`](守岸人3.0/frontend/voice-chat.html:521)

**建议修复**：

```js
const ticketRes = await fetch(`/api/voice-chat/${currentSessionId}/ws-ticket`, {
  headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
});
const { ticket } = await ticketRes.json();

const wsUrl = `${protocol}//${window.location.host}/api/voice-chat/ws/${currentSessionId}?ticket=${encodeURIComponent(ticket)}`;
```

---

### 2. 角色语音上传后保存失败：后端 DB 分支没有返回 JSON

**影响**：主聊天页保存 DB 角色时，如果上传了参考音频，`API.postForm('/api/characters/${id}/voice')` 会收到空响应，前端解析 JSON 失败，导致保存流程抛错。

**证据**：

- 前端保存角色后上传 voice，并期望 JSON 响应：[`frontend/js/app.js:714`](守岸人3.0/frontend/js/app.js:714)
- 后端 DB 分支上传后没有 `return`：[`server/routers/characters.py:319`](守岸人3.0/server/routers/characters.py:319)
- 文件角色分支有返回：[`server/routers/characters.py:310`](守岸人3.0/server/routers/characters.py:310)

**建议修复**：在 [`server/routers/characters.py:322`](守岸人3.0/server/routers/characters.py:322) 后添加：

```python
return {"voice": voice_name}
```

---

### 3. 角色 PNG 导出有不可达代码和潜在 NameError

**影响**：没有头像或 Pillow 未安装时，PNG 导出可能失败；`db.refresh(character)` 和 `return {"voice": voice_name}` 位于 `return FileResponse(...)` 后面，永远执行不到。

**证据**：

- 使用 `HAS_PILLOW` / `Image`，但函数内没有导入：[`server/routers/characters.py:438`](守岸人3.0/server/routers/characters.py:438)
- `HAS_PILLOW` 和 `Image` 来自 [`server/utils/character_card.py:9`](守岸人3.0/server/utils/character_card.py:9)，不是 `characters.py`
- 返回文件后还有不可达代码：[`server/routers/characters.py:462`](守岸人3.0/server/routers/characters.py:462)

**建议修复**：在 `export_character_png` 内导入：

```python
from ..utils.character_card import card_to_tavern_v2, write_card_to_png, HAS_PILLOW
try:
    from PIL import Image
except ImportError:
    Image = None
```

并删除函数末尾不可达代码。

---

### 4. 角色 PNG 导出的头像路径可能拼错

**影响**：DB 角色设置了头像后，导出 PNG 可能找不到源图片。

**证据**：

- 前端/后端头像路径常见为 `/avatars/xxx`。
- 后端直接拼接：[`server/routers/characters.py:432`](守岸人3.0/server/routers/characters.py:432)

```python
candidate = characters_dir / "avatars" / character.avatar_url
```

如果 `avatar_url = "/avatars/foo.png"`，会变成 `avatars//avatars/foo.png`。

**建议修复**：

```python
avatar_name = character.avatar_url.lstrip("/avatars/")
candidate = characters_dir / "avatars" / avatar_name
```

---


### 5 默认 JSON 角色可能无法用于聊天/语音/群聊

**影响**：如果默认角色来自 JSON 文件而不是 DB，普通聊天、语音聊天、群聊可能因为外键或只查 DB 而失败。

**证据**：

- `ChatSession.character_id` 外键到 DB 的 `characters.id`：[`server/models/chat_db.py:13`](守岸人3.0/server/models/chat_db.py:13)
- 创建聊天会话时直接写 `character_id`：[`server/routers/chat.py:681`](守岸人3.0/server/routers/chat.py:681)
- 语音聊天 start 只查 `CharacterDB`：[`server/routers/voice_chat.py:51`](守岸人3.0/server/routers/voice_chat.py:51)
- 群聊创建不校验角色存在：[`server/routers/group_chat.py:91`](守岸人3.0/server/routers/group_chat.py:91)
- 群聊添加成员只查 DB：[`server/routers/group_chat.py:213`](守岸人3.0/server/routers/group_chat.py:213)

**建议修复**：二选一：

1. 将 JSON 默认角色迁移进 DB；
2. 放宽 `ChatSession.character_id` 外键约束，并让 voice/group 统一支持 JSON 角色加载。

---

### 6. 记忆后台任务传入 SQLAlchemy Session，可能间歇性失败

**影响**：每 10 条消息触发长期记忆提取，但后台任务可能拿到已关闭/请求绑定的 Session，导致记忆功能不稳定。

**证据**：

- 创建后台任务时传入 `db`：[`server/routers/chat.py:413`](守岸人3.0/server/routers/chat.py:413)
- 摘要任务同样传入 `db`：[`server/routers/chat.py:417`](守岸人3.0/server/routers/chat.py:417)

**建议修复**：后台任务内重新 `with SessionLocal() as task_db:`，不要跨请求传递 `db`。

---

---

### 7. 设置页普通用户无法保存配置

**影响**：前端设置页允许用户保存设置，但后端 `update_settings` 需要管理员权限，普通用户会 403。

**证据**：

- 后端 `update_settings` 使用 `get_current_admin`：[`server/routers/settings.py:22`](守岸人3.0/server/routers/settings.py:22)
- 前端普通保存调用 `API.put('/api/settings')`：[`frontend/js/app.js:662`](守岸人3.0/frontend/js/app.js:662)

**建议修复**：拆分普通用户设置和系统设置，或前端管理员才显示保存系统配置入口。

---

### 8. 记忆页功能错位：页面叫“记忆”，实际读取的是用户偏好

**影响**：用户打开记忆页看不到长期记忆摘要，只会看到 affinity preferences。

**证据**：

- 页面标题/文案是记忆中心。
- 前端调用 `/api/affinity/preferences`：[`frontend/memory.html:403`](守岸人3.0/frontend/memory.html:403)
- 后端长期记忆接口在 [`server/routers/memory.py:33`](守岸人3.0/server/routers/memory.py:33)
- 后端摘要接口在 [`server/routers/memory.py:114`](守岸人3.0/server/routers/memory.py:114)

**建议修复**：记忆页应调用 `/api/memories/{character_id}` 和 `/api/memories/{character_id}/summaries`，或改名为“偏好设置”。

---

