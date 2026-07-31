# 守岸人聊天体验增强设计

## 目标

在保留守岸人现有 FastAPI、SQLAlchemy、SQLite、原生前端和 `site-auth` 统一认证的前提下，补齐可靠的消息滑动、编辑、删除、分支、检查点、搜索、导出与备份能力。

本阶段参考 SillyTavern 的用户交互语义，但不复制其 AGPL-3.0 源代码。实现、数据模型、接口和前端代码均在守岸人现有架构上独立完成。

## 当前状态

守岸人已经具备：

- `ChatSession` 与 `ChatMessage` 持久化。
- AI 消息的 `swipes` 和 `swipe_id` 字段。
- 生成新 swipe 与切换 swipe 的接口。
- JSONL 导入导出接口。
- 基础会话列表和清空历史接口。

当前缺口：

- 历史接口不返回消息 ID、swipes 和当前 swipe，页面刷新后滑动控件丢失。
- 重新生成读取了目标回复及其后续内容，不是严格的“重新回答上一条用户消息”。
- 没有消息编辑、单条删除、分支和检查点。
- JSONL 只表达线性消息，不能完整备份分支、检查点和所有候选回复。
- 缺少聊天内容搜索和可恢复的自动备份。
- 现有聊天功能没有独立的 API 测试覆盖。

## 核心原则

- **非破坏式历史：** 编辑、删除和分叉不能覆盖原始对话，旧分支始终可以恢复。
- **单一活动路径：** 每个会话保存一个当前分支；构建提示词时只读取该分支从根到当前头部的消息。
- **Swipe 不是分支：** 同一条 AI 消息的多个候选回复仍保存在 `swipes`；只有从某个历史节点继续产生后续消息时才创建分支。
- **统一用户隔离：** 所有查询先用 `site-auth` 用户 ID 限定会话，再访问消息、分支、检查点或导出。
- **失败不污染历史：** LLM 生成失败、导入失败或并发冲突不得写入半成品记录。

## 数据模型

### ChatSession 扩展

- `current_branch_id`：当前活动分支。
- `title`：用户可编辑的会话标题。
- `version`：并发修改版本号。
- `updated_at`：任何活动路径变更时更新。

### ChatBranch

- `id`
- `session_id`
- `parent_branch_id`
- `fork_message_id`：从父分支的哪条消息之后分叉；根分支为空。
- `name`
- `created_at`

每个会话初始化一个根分支。旧数据库中的所有消息迁移到根分支，并将它设为当前分支。

### ChatMessage 扩展

- `branch_id`
- `parent_message_id`
- `edited_at`
- `sequence`：分支内稳定排序号。

现有 `content`、`swipes` 和 `swipe_id` 保留。提示词始终采用当前选中的 swipe 文本。

### ChatCheckpoint

- `id`
- `session_id`
- `branch_id`
- `message_id`
- `name`
- `created_at`

检查点指向一个不可变的分支位置。恢复检查点只切换当前分支和头部位置，不删除较新的历史。

### ChatBackup

备份使用版本化 JSON 文件，而不是新增数据库表。文件包含会话、分支、消息、全部 swipes 和检查点，写入 `data/backups/chats/{user_id}/`。每次结构性修改后异步创建备份，每个会话最多保留最近 20 份。

## 操作语义

### 加载历史

历史接口返回当前活动路径上的完整消息对象：

- `id`
- `role`
- `content`
- `swipes`
- `swipe_id`
- `branch_id`
- `parent_message_id`
- `created_at`
- `edited_at`

前端刷新后必须恢复滑动计数、当前候选和消息操作按钮。

### 重新生成与切换 Swipe

- 重新生成只使用目标 AI 消息之前的活动路径构建上下文。
- 新回复成功后追加到目标消息的 `swipes`，并选中新候选。
- 生成失败时不修改原消息。
- 切换 swipe 只改变 `swipe_id` 与显示内容，不创建分支。
- 如果目标消息存在后续消息，切换 swipe 后继续发送新消息时自动从目标处创建新分支，避免改写旧后续。

### 编辑

编辑任意用户或 AI 消息都会从该消息的父节点创建新分支：

- 新分支复制活动路径引用，不复制历史记录。
- 编辑后的内容作为新分支中的新消息。
- 原消息与原后续保持不变。
- 会话切换到新分支。

### 删除

删除是非破坏式截断：

- 从待删除消息的父节点创建新分支。
- 新分支的头部停在父节点，因此待删除消息及其后续不出现在新活动路径。
- 原分支仍可通过分支列表恢复。

### 检查点

- 用户可以在当前活动路径任意消息处创建命名检查点。
- 恢复检查点会切换到对应分支并把活动头部设到该消息。
- 同一用户只能操作自己的检查点。

### 搜索与导出

- 搜索范围为当前用户的会话标题、角色名称、当前内容和所有 swipe 文本。
- 返回会话、消息、命中片段、分支和时间。
- JSONL 导出默认只导出当前活动路径，保持与现有格式兼容。
- 完整备份导出使用版本化 JSON，保留整个分支图和检查点。

## API

在现有 `/api/chat` 下新增或收紧：

- `GET /history`：返回带完整元数据的当前活动路径。
- `PATCH /messages/{message_id}`：非破坏式编辑。
- `DELETE /messages/{message_id}`：非破坏式截断。
- `POST /messages/{message_id}/regenerate`：追加 swipe。
- `PUT /messages/{message_id}/swipe`：切换 swipe。
- `GET /sessions/{session_id}/branches`
- `POST /sessions/{session_id}/branches/{branch_id}/activate`
- `POST /sessions/{session_id}/checkpoints`
- `GET /sessions/{session_id}/checkpoints`
- `POST /checkpoints/{checkpoint_id}/restore`
- `DELETE /checkpoints/{checkpoint_id}`
- `GET /search?q=...`
- `GET /export?format=jsonl|backup`
- `POST /import?format=jsonl|backup`

修改类请求继续使用 `sd_session` 和 CSRF 校验。服务端不接受客户端提供的 `user_id`。

## 前端

聊天气泡增加悬浮操作栏：

- 编辑
- 删除
- 重新生成
- 左右切换 swipe
- 创建检查点
- 从此处分支

会话侧栏增加：

- 会话标题和消息数。
- 分支选择器。
- 检查点列表。
- 搜索入口。
- JSONL 和完整备份导出。

破坏感较强的动作必须明确提示“原分支仍会保留”。生成、导入和恢复操作显示进行中、成功或失败状态，不能静默失败。

## 并发与错误处理

- 修改请求携带会话 `version`；版本不一致返回 409，由前端重新加载。
- LLM 请求在事务外执行，成功后用短事务追加 swipe。
- 数据库写入失败回滚，不更新前端本地状态。
- 导入限制为 10 MiB；逐行验证角色、内容类型和最大消息数 20,000。
- 备份采用临时文件加原子替换，失败只记录错误，不影响聊天主流程。
- 所有越权访问统一返回 404，避免泄露其他用户资源是否存在。

## 迁移

迁移必须可重复执行：

1. 创建 `chat_branches` 和 `chat_checkpoints`。
2. 为现有会话创建根分支。
3. 按 `created_at` 与 `id` 为旧消息回填 `branch_id`、`parent_message_id` 和 `sequence`。
4. 设置 `current_branch_id` 和 `version=1`。
5. 保留现有 `swipes` 和 `swipe_id`，不改写内容。

SQLite 与 PostgreSQL 都必须支持。迁移前不删除任何表或列。

## 测试

后端自动化测试至少覆盖：

- 历史接口恢复消息 ID、swipes 和选中项。
- 重新生成的上下文不包含目标消息及其后续。
- 编辑和删除创建新分支且原分支可恢复。
- 检查点创建、恢复和删除。
- 用户 A 无法读取或修改用户 B 的资源。
- 搜索只返回当前用户数据。
- JSONL 兼容导入导出。
- 完整备份往返后分支图一致。
- 版本冲突返回 409。
- LLM 或数据库失败不产生半条消息。

前端验证覆盖刷新恢复、左右滑动、分支切换、检查点恢复、错误提示和窄屏布局。

## 非目标

- 本阶段不实现插件市场、正则脚本、快捷回复和提示词预设。
- 本阶段不复制或运行 SillyTavern 前端。
- 本阶段不改变模型供应商配置、TTS、STT、记忆提取或世界书算法。
- 本阶段不处理 Persona、Character Card V3 完整字段或 CharX；这些属于下一阶段。
