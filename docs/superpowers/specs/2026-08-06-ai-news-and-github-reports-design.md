# GitHub、AI 生态与 AI 早报设计

**日期：** 2026-08-06

## 目标

在现有独立研报服务的基础上，解决 GitHub 榜单长时间无结果的问题，并增加三个可独立浏览、可独立失败和可独立更新的内容域：

1. GitHub 综合榜与语言榜：公开 Trending 页面优先，不依赖 GitHub Token。
2. AI 生态榜：从公开 GitHub Trending 和公开仓库页面筛选 AI Agent、AI Skill、MCP、RAG、模型服务等项目。
3. AI 早报：聚合过去 24 小时的公开新闻/RSS 与可索引的 X/Twitter 内容，使用站点 AI 配置调用硅基流动 DeepSeek V4 Flash 生成中文早报。

## 现状与根因

当前 `research-reports` 已具备 SQLite 数据模型、GitHub Trending HTML 解析、每小时/每周调度、统一认证和 React 页面，但采集流程把 Trending 抓取与 GitHub REST 元数据补充放在同一个分类任务内，并且逐仓库串行补充元数据。

服务器实测结果：

- `https://github.com/trending?since=weekly` 可以直接返回公开 HTML。
- `https://api.github.com/repos/...` 在无认证请求下返回 `403`。
- 公开 RSS 可直接访问。

因此，榜单结果不应等待 REST 元数据。Trending 页面解析成功后必须立即提交榜单；元数据只能作为可取消、限额、可恢复的后台增强步骤。

## 设计原则

- **公开源优先：** GitHub、RSS、可公开索引的网页是默认来源；任何 Token 都是可选增强，不是启动条件。
- **结果优先：** 先落库可展示的榜单或新闻候选，再异步做摘要、元数据和去重。
- **分域隔离：** GitHub、AI 生态、社交大事、AI 早报分别有运行记录和状态；某一源失败不能清空其他内容。
- **可追溯：** 每条内容保留来源 URL、来源名称、发布时间、抓取时间、原始标题和摘要依据。
- **AI 可降级：** DeepSeek 调用失败时仍展示候选新闻和规则摘要，并标记 `ai_unavailable`，不能写入伪造的模型结论。
- **安全复用：** 复用现有 `site-auth` 会话和管理员权限；API Key 只从 `.env.local` 或既有管理员配置读取。

## 内容域

### 1. GitHub 榜单

保留现有综合、Python、JavaScript、TypeScript、Go、Rust 六类榜单。

采集流程改为：

1. 并行请求六个公开 Trending HTML 页面。
2. 每个分类独立解析、校验和写入 `RankingEntry`。
3. 六个分类写入完成后，立即将本次运行标记为 `success` 或 `partial`。
4. 后台元数据增强只处理有限数量的仓库，并记录 `metadata_delayed`、`rate_limited` 或 `unavailable`。
5. 失败分类保留最近一次成功榜单，当前运行不删除旧数据。

新增采集状态字段：

- `fetching`：正在获取公开页面。
- `ranking_persisted`：榜单已可展示。
- `metadata_enriching`：正在补充可选元数据。
- `success`、`partial`、`failed`、`skipped_overlap`。

### 2. AI 生态榜

AI 生态不是简单按语言筛选，而是对仓库元数据和 Trending 文本做分类打分。默认分类：

- `agent_skill`：AI Agent、Skill、工具调用、工作流。
- `mcp`：MCP Server、MCP Client、MCP 工具生态。
- `llm_rag`：LLM、RAG、Embedding、向量数据库、评测。
- `computer_use`：浏览器代理、Computer Use、桌面自动化。
- `ai_app`：开源 AI 应用、Coding Agent、聊天和生产力应用。
- `ai_infra`：推理、模型服务、训练、GPU、部署和观测。

分类打分使用可测试的关键词权重：仓库 topics 权重最高，名称次之，描述最低；命中负向词（例如纯教程、课程资料、数据集镜像）时降权。每个项目保留命中的分类和解释，页面展示“为什么进入 AI 榜”。

### 3. 社交大事

不接入 X API，不要求 X Token。使用公开 RSS/网页聚合：

- Google News RSS 查询 `site:x.com`、`site:twitter.com`。
- 重点账号和机构关键词：特朗普、Google、OpenAI、Anthropic、Meta、Microsoft、NVIDIA、xAI、DeepMind。
- 对公开新闻页面和搜索结果做去重，保留原文 URL。

由于公开 RSS 不等于完整 X 时间线，页面明确展示来源类型：`x_indexed`、`news_report`、`rss`。抓不到完整帖子时，不生成“某人确实说过”的断言，只展示可验证的新闻标题和原文。

### 4. AI 早报

每日生成一份滚动早报，候选时间窗为当前时间往前 24 小时。候选源包括：

- Google News RSS 的 AI、LLM、Agent、芯片、模型发布查询。
- GitHub AI 生态榜的新增和快速增长项目。
- 社交大事中的高重要性条目。

早报输出结构：

- 今日摘要：不超过 5 条核心判断。
- 重点事件：标题、发生时间、来源、事实摘要、影响、原文链接。
- GitHub 动态：新增项目、快速增长项目、生态趋势。
- 风险提示：来源冲突、信息不足、尚未证实的内容。

AI 生成要求：

- 默认 provider：`siliconflow`。
- 默认模型配置名：`deepseek-v4-flash`，实际模型 ID 从站点模型配置或环境变量读取，不在代码中写死供应商路径。
- 请求采用 OpenAI Chat Completions 兼容格式。
- Prompt 强制要求只基于输入资料，不补写未提供的事实；每个判断引用候选条目的 `source_id`。
- 模型失败时保存候选列表和规则摘要，状态为 `ai_unavailable`。

## 数据模型

保留现有 `Repository`、`RankingEntry`、`WeeklyIssue`、`CollectionRun`，新增以下实体：

### `ContentSource`

- `id`
- `kind`：`github_trending`、`rss`、`news_search`、`x_indexed`
- `name`
- `url`
- `enabled`
- `last_success_at`
- `last_error`

### `NewsItem`

- `id`
- `source_id`
- `canonical_url`
- `title`
- `summary`
- `published_at`
- `fetched_at`
- `author_or_publisher`
- `topics_json`
- `importance_score`
- `content_hash`
- `status`：`candidate`、`selected`、`merged`、`hidden`

### `AIReport`

- `id`
- `report_date`
- `window_start`
- `window_end`
- `status`：`generating`、`success`、`partial`、`ai_unavailable`、`failed`
- `model_provider`
- `model_name`
- `title`
- `summary_markdown`
- `source_ids_json`
- `generated_at`
- `error_message`

### `AICollectionRun`

- `id`
- `domain`：`github_ai`、`social_events`、`ai_briefing`
- `trigger`
- `started_at`
- `finished_at`
- `status`
- `counts_json`
- `error_summary`

## API

公开 API：

- `GET /api/v1/ai/rankings/current`
- `GET /api/v1/ai/rankings?category=agent_skill`
- `GET /api/v1/news?window=24h&topic=ai`
- `GET /api/v1/news/social-events?window=24h`
- `GET /api/v1/briefings/latest`
- `GET /api/v1/briefings/{report_id}`
- `GET /api/v1/content-sources`

管理员 API：

- `POST /api/v1/admin/collections/github`
- `POST /api/v1/admin/collections/ai`
- `POST /api/v1/admin/collections/news`
- `POST /api/v1/admin/briefings/generate`
- `GET /api/v1/admin/collection-runs`

所有管理员 POST 继续要求统一账号、Origin 和 CSRF 校验。公开接口只返回清洗后的标题、摘要、来源和链接，不返回 API Key、原始响应头或内部错误细节。

## 调度

- 每小时整点：GitHub 六榜和 AI 生态榜。
- 每 30 分钟：RSS/新闻候选抓取，时间窗 24 小时。
- 每天 08:30 Asia/Shanghai：生成 AI 早报。
- 管理员可单独刷新 GitHub、AI 生态、新闻候选或早报生成。
- 同一内容域使用独立非阻塞锁；不同域可并行。

## 页面

现有 `/reports` 改为研报入口页，新增：

- `/reports/github`：综合榜、语言榜和采集进度。
- `/reports/ai`：AI 生态分类榜、命中原因、增长信号。
- `/reports/news`：过去 24 小时大事流，筛选来源和主题。
- `/reports/briefing`：AI 早报正文、引用来源、生成状态和更新时间。

管理员可见独立刷新按钮和运行详情；普通用户只能浏览公开数据。

## 失败与安全

- RSS 源超时：跳过该源，保留旧候选并标记源状态。
- GitHub HTML 结构变化：分类失败不删除旧榜，记录解析错误样本。
- DeepSeek 限流/错误：早报进入 `ai_unavailable`，保留候选资料。
- 同一 URL 使用规范化 URL 和内容哈希去重。
- 采集响应设置单源超时、总预算和最大条目数。
- `.env.local`、数据库、缓存、原始 HTML、运行日志继续被 Git 忽略。

## 验收标准

1. 无 GitHub Token 时，六个 GitHub 榜单在可接受时间内先返回结果。
2. GitHub REST 403 不再导致整次采集长时间无结果。
3. AI 生态至少能稳定产出六类榜单中的有效项目。
4. 过去 24 小时新闻可按来源、主题和时间筛选。
5. DeepSeek 生成成功时早报包含引用来源；生成失败时仍可浏览候选新闻。
6. 匿名用户可读，普通用户不能刷新，管理员可以单独刷新各内容域。
7. 现有股票、OpenWrite、守岸人和统一认证功能不受影响。
