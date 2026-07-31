# 守岸人 Persona、世界书与角色包增强设计

## 目标

在聊天体验增强完成后，为守岸人增加用户 Persona、高级世界书求值、Character Card V2/V3 完整字段保存，以及 CharX 安全导入导出。

本阶段继续保留 `site-auth` 作为唯一用户身份来源，并在守岸人当前 FastAPI、SQLAlchemy、SQLite/PostgreSQL 和原生前端上独立实现。SillyTavern 仅作为行为和格式研究参考，不复制其 AGPL-3.0 代码。

## 当前状态

守岸人已经具备：

- 角色基本资料、系统提示词、首条消息、示例对话和标签。
- Tavern Card PNG/JSON 基础导入导出。
- 对 PNG 中 `chara` 与 `ccv3` 文本块的读取。
- 世界书及大量高级字段的数据模型。
- 基础关键词、正则、优先级和最多五条注入。

当前缺口：

- 没有用户 Persona，也不能按会话切换用户身份设定。
- 角色卡导入会丢失场景、作者信息、备用开场、后置指令、嵌入式世界书和未知扩展字段。
- V3 目前只识别 PNG 关键字，没有完整的版本化字段映射。
- 没有 CharX 资源包。
- 世界书模型中的次关键词、逻辑、常驻、概率、冷却、分组、插入位置、递归和扫描深度大多未进入实际提示词构建。
- 没有统一 Token 预算和触发诊断。

## Persona

### 数据模型

新增 `personas`：

- `id`
- `user_id`
- `name`
- `description`
- `avatar_path`
- `system_prompt`
- `is_default`
- `created_at`
- `updated_at`

`chat_sessions` 增加可空的 `persona_id`。Persona 只能由所属 `site-auth` 用户查看、修改和使用。

### 提示词行为

Persona 在角色定义之后、聊天历史之前注入：

- `description` 描述用户在故事中的身份。
- `system_prompt` 提供额外的用户扮演约束。
- 会话未选择 Persona 时使用该用户的默认 Persona。
- 没有默认 Persona 时保持现有提示词行为。

删除 Persona 前必须解除或迁移会话引用。已经生成的历史消息不改写。

## 高级世界书求值器

把世界书匹配从聊天路由抽离为独立 `LorebookEvaluator`，输入为：

- 当前用户消息。
- 当前活动分支最近 N 条消息。
- 当前角色和 Persona。
- 当前会话的历史触发状态。
- 可用 Token 预算。

输出为按插入位置分组的不可变条目集合和触发诊断。

### 匹配规则

- 主关键词支持多个普通词和 `/正则/`。
- 次关键词按 `and` 或 `or` 与主关键词组合。
- 支持大小写敏感和全词匹配。
- `constant` 条目无需关键词即可参与。
- 扫描深度使用 Lorebook 的 `scan_depth`，而不是只检查当前输入。
- 无效正则记录诊断并回退为普通文本匹配，不中断聊天。

### 选择规则

处理顺序固定为：

1. 过滤禁用条目。
2. 执行关键词匹配或常驻判断。
3. 应用冷却。
4. 应用概率。
5. 按 group 与权重选取。
6. 按 position、depth、order 和稳定 ID 排序。
7. 按 Token 预算截断。
8. 最多执行两轮递归；`exclude_recursion` 条目不参与下一轮扫描。

概率随机源可注入，保证测试可复现。冷却状态按会话与条目记录，不跨用户共享。

### 插入位置

- `before_char`：角色定义之前。
- `after_char`：角色定义之后。
- `depth`：插入活动历史的指定深度。

Token 预算默认不超过模型上下文预算的 20%，并设绝对上限。预算耗尽时优先保留高优先级、常驻和更高 order 的条目。

前端提供“本次触发诊断”，显示命中、被冷却、概率未通过、分组落选和预算裁剪原因，但不展示服务端密钥或隐藏系统配置。

## Character Card V2/V3

### 保留字段

内部角色记录扩展并保留：

- `scenario`
- `creator_notes`
- `post_history_instructions`
- `alternate_greetings`
- `creator`
- `character_version`
- `card_spec`
- `card_spec_version`
- `card_extensions`
- `embedded_lorebook_id`

未知 `extensions` 必须原样作为 JSON 保存并在再次导出时保留。导入不能因为守岸人暂不使用某个扩展字段而丢弃它。

### 格式处理

- V2 JSON/PNG 按 `chara_card_v2` 映射。
- V3 PNG 优先读取 `ccv3`，校验规范字段后映射。
- 简单旧版 JSON 继续兼容。
- 嵌入式 `character_book` 导入为角色关联 Lorebook。
- 导出时可以选择 V2 或 V3；不能表达的字段保留在扩展区并给出提示。

解析层返回结构化警告，区分致命格式错误和可忽略的未知字段。

## CharX

CharX 被视为不可信 ZIP 容器。导入限制：

- 压缩包最大 20 MiB。
- 文件数最多 200。
- 解压后总大小最多 50 MiB。
- 单文件最大 10 MiB。
- 拒绝绝对路径、`..`、驱动器路径、符号链接和重复覆盖路径。
- 只接受 JSON、PNG、JPEG、WebP、GIF、WAV、MP3、OGG 和文本资源。
- 清理文件名并在用户隔离的数据目录中解压。

导入先完整验证到临时目录，校验通过后再原子移动到正式位置。失败时删除临时目录且不创建角色记录。

导出包含：

- 版本化角色卡 JSON。
- 头像与已引用资源。
- 嵌入式世界书。
- 资源清单及内容哈希。

不打包 API Key、用户 Persona、聊天记录、绝对路径或服务器配置。

## API 与前端

### Persona API

- `GET /api/personas`
- `POST /api/personas`
- `PUT /api/personas/{persona_id}`
- `DELETE /api/personas/{persona_id}`
- `PUT /api/chat/sessions/{session_id}/persona`

### 世界书

保留现有 Lorebook CRUD，补全高级字段验证，并新增：

- `POST /api/lorebooks/evaluate-preview`
- `GET /api/chat/sessions/{session_id}/lorebook-diagnostics`

### 角色包

- 现有角色导入端点支持 `.json`、`.png` 和 `.charx`。
- 导出端点显式选择 `json-v2`、`png-v2`、`json-v3`、`png-v3` 或 `charx`。

前端新增 Persona 管理器、会话 Persona 选择器、世界书高级编辑器、触发预览和角色包导入报告。

## 迁移与兼容

- 为现有角色补充可空字段，不改变已有基本字段。
- 现有世界书字段原样保留。
- 已有角色卡没有规范版本时标记为 `legacy`。
- 现有会话 `persona_id` 为空，行为与升级前一致。
- 迁移可重复执行，SQLite 与 PostgreSQL 均支持。
- 升级前后 V2 JSON 和 PNG 的基础字段必须往返一致。

## 错误处理与安全

- 所有 Persona、角色私有资源和世界书操作按当前用户校验。
- 角色共享内容与用户私有内容分开存储和授权。
- 解析错误返回稳定错误码、文件名和安全的原因摘要，不返回服务器绝对路径。
- 正则设置最大长度并使用超时或受限执行策略，防止灾难性回溯阻塞请求。
- 世界书诊断限制数量和文本长度。
- 上传文件使用流式大小限制，不能先无限制读入内存。

## 测试

自动化测试至少覆盖：

- Persona CRUD、默认选择、会话绑定和跨用户隔离。
- Persona 正确进入提示词且不改写历史。
- 世界书所有匹配、概率、冷却、分组、递归、插入位置和预算规则。
- 无效正则不会中断聊天。
- V2/V3 JSON 与 PNG 往返保留字段和未知 extensions。
- 嵌入式世界书导入。
- CharX 正常导入导出。
- 路径穿越、压缩炸弹、符号链接、超限文件和非法类型被拒绝。
- 导入失败不留下角色、文件或临时目录。
- 旧角色、旧世界书和无 Persona 会话保持兼容。

## 非目标

- 本阶段不实现 SillyTavern 插件、扩展商店、快捷回复或正则脚本执行器。
- 不直接运行 SillyTavern 服务或共享其用户数据目录。
- 不复制 SillyTavern AGPL-3.0 源代码。
- 不改变 `site-auth` 的密码、会话或管理员模型。
- 不把聊天记录放入 Character Card 或 CharX。
