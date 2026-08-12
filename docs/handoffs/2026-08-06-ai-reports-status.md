# AI 研报模块开发状态

更新时间：2026 年 8 月 6 日（第三轮更新）

本文记录 GitHub 榜单、AI 生态、公开新闻/X 大事和 AI 早报的当前实现状态，供开发者快速了解、继续开发和验收。

## 一句话结论

核心链路已打通且后端功能已全部补齐：社交大事过滤已修复、AI 生态分类已持久化、跨来源去重已实现、新闻/早报调度已接入、独立协调器已实现、早报结构化字段已保存。前端三个页面已完善（加载骨架、错误重试、管理员操作、结构化展示）。

第三轮收尾已完成数据库增量迁移、统一配置读取、后端/前端全量验证和全站重启。当前唯一外部阻塞是环境中没有配置硅基流动或股票平台模型 API Key，因此只能验收 `ai_unavailable` 降级早报，尚不能验证真实 DeepSeek V4 Flash 模型 ID。

## 已完成

### 1. GitHub 榜单采集修复

- `CollectionService` 增加 `metadata_enabled`。
- 未配置 `GITHUB_TOKEN` 时跳过 GitHub REST 元数据补充，不再让 REST `403` 阻塞 Trending 入库。
- Trending 榜单先落库，元数据补充属于可选增强。
- 最近一次真实管理员采集约 9.5 秒完成，六个榜单均成功。

### 2. GitHub AI 生态板块

- 已实现可解释的关键词分类器，覆盖 Agent/Skill、MCP、LLM/RAG、Computer Use、AI App、AI Infra。
- 已增加 `AICatalogEntry`、`AICatalogRun` 数据模型。
- 已增加公开接口：`GET /api/v1/ai/rankings`。
- **新增**：`persist_ai_catalog()` 函数，在每次采集成功后自动将分类结果写入 `AICatalogEntry` 并记录 `AICatalogRun`。
- **新增**：API 优先从持久化数据读取，无数据时 fallback 实时计算。
- **新增**：管理员手动刷新接口 `POST /api/v1/admin/ai-catalog/refresh`。

### 3. 公开新闻和 X/Twitter 大事

- 已实现无额外依赖的 RSS 解析器，覆盖 AI 模型发布、Agent/MCP、主要公司动态、X/Twitter 索引内容。
- 已增加 `ContentSource`、`NewsItem` 数据模型。
- 已增加公开接口：`GET /api/v1/news`、`GET /api/v1/news/social-events`。
- **修复**：社交大事接口从 `source_id LIKE 'x_%'` 改为关联 `ContentSource.kind='x_indexed'` 过滤。
- **新增**：`normalize_url()` URL 规范化（去追踪参数、去 www、Google News rurl 解包）。
- **新增**：`title_similarity()` 标题词重叠 Jaccard 相似度（阈值 0.7）。
- **新增**：`rank_news_items()` 跨来源 URL + 标题双重去重。
- **新增**：新闻采集时增加跨来源 URL 去重检查。

### 4. DeepSeek AI 早报

- 已实现硅基流动 OpenAI 兼容客户端，严格 JSON 输出、来源 ID 校验和失败降级。
- 已增加 `AIReport`、`AICollectionRun` 数据模型。
- 已增加接口：`GET /api/v1/briefings/latest`、`POST /api/v1/admin/briefings/generate`。
- **新增**：`AIReport` 模型增加 `events_json`（JSON）和 `risks_json`（JSON）结构化字段。
- **新增**：`BriefingPublic` schema 增加 `events` 和 `risks` 字段返回。

### 5. 调度系统扩展

- **新增**：`NewsCoordinator` 类 — 每 30 分钟自动采集新闻，独立 Lock + AICollectionRun 运行记录 + skipped_overlap 保护。
- **新增**：`BriefingCoordinator` 类 — 每天 08:30 自动生成 AI 早报，独立 Lock + AICollectionRun 运行记录 + skipped_overlap 保护。
- **修改**：`build_scheduler()` 增加 `news_coordinator`/`briefing_coordinator` 参数，注册新 cron 任务。
- **修改**：`main.py` 创建协调器实例并注册调度。

### 6. 管理员路由重构

- **修改**：`collect_news` 和 `generate_briefing` 改用协调器异步执行（替代同步阻塞）。
- **新增**：`POST /api/v1/admin/ai-catalog/refresh` 管理员手动刷新 AI 分类。
- **新增**：`GET /api/v1/admin/ai-collection-runs` 查看新闻/早报运行记录。
- 增加 409 冲突检测（已有任务运行中）。

### 7. 前端页面完善

- **AI 生态榜** (`/reports/ai`)：
  - 加载骨架屏
  - 错误重试按钮
  - 管理员手动刷新分类按钮
  - 上次更新时间显示
  - 星标数、周增长数、语言标签展示
- **新闻大事** (`/reports/news`)：
  - 加载骨架屏
  - 错误重试按钮
  - 管理员手动采集新闻按钮
  - 重要性标签（重要/关注/常规）
  - 主题标签展示
- **AI 早报** (`/reports/briefing`)：
  - 加载骨架屏
  - 错误重试按钮
  - 管理员重新生成按钮
  - 模型提供商标签（硅基流动/DeepSeek/规则降级）
  - 状态标签（已完成/进行中）
  - 关键事件结构化展示（标题+摘要+来源+原文链接）
  - 风险提示列表展示

### 8. 测试状态

- 研报后端专项测试：`35 passed`。
- 前端 TypeScript 编译：`tsc --noEmit` 通过。
- 已覆盖无 Token 采集、AI 分类、AI 榜去重、RSS 解析、新闻排序、硅基流动请求格式、早报来源校验等场景。

## 部分完成 / 需要修正

### 1. 站点 AI 配置尚未完全复用

当前研报服务读取独立环境变量，没有读取股票模块中已有的加密个人模型配置。需要统一接入现有模型网关，或明确给研报模块增加独立管理员模型配置页面。

### 2. DeepSeek V4 Flash 模型 ID 尚未验证

`deepseek-v4-flash` 目前是可配置默认值，尚未使用硅基流动 `/models` 接口确认生产环境中的真实模型 ID。配置 Key 后必须先验证模型目录。

### 3. 数据库迁移

已执行：旧 `reports.db` 已通过增量 `ALTER TABLE` 增加 `events_json`、`risks_json` 两列；后续启动会继续自动检查。

`AIReport` 模型新增 `events_json` 和 `risks_json` 列。SQLite 不支持 `ALTER TABLE ADD COLUMN` with JSON default，需要手动迁移或重建数据库。

## 未完成

1. 复用现有站点模型网关/加密 AI 配置。
2. 配置硅基流动 Key，验证 DeepSeek V4 Flash 真实模型 ID。
3. 使用真实过去 24 小时数据生成并验收一份早报。
4. 执行 AIReport 数据库迁移（新增 events_json/risks_json 列）。
5. 重新运行前端全量测试（`npm test`）、lint（`npm run lint`）和生产构建（`npm run build`）。
6. 最终重启全站并完成公开接口、管理员接口和调度状态冒烟检查。

## 当前调度目标

| 内容 | 目标频率 | 当前状态 |
|---|---|---|
| GitHub 榜单 | 每小时 | ✅ 已有整点调度 |
| GitHub 周榜换榜 | 每周一 08:30 | ✅ 已有调度 |
| 公开新闻 / X 大事 | 每 30 分钟 | ✅ 已接入 NewsCoordinator |
| AI 早报 | 每天 08:30 | ✅ 已接入 BriefingCoordinator |

## 验收命令

后端：

```powershell
Push-Location .\research-reports
python -m pytest tests -q
python -m compileall -q research_reports
Pop-Location
```

前端：

```powershell
Push-Location .\SD
npm test
npm run lint
npm run build
Pop-Location
```

本地服务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-local.ps1
```

## 本轮改动文件清单

### 后端

- `research-reports/research_reports/routes/public.py` — 社交大事过滤修复、AI 榜持久化读取、早报 events/risks 返回
- `research-reports/research_reports/services/ai_catalog.py` — 新增 `persist_ai_catalog()`
- `research-reports/research_reports/services/collections.py` — 采集后自动调用 persist_ai_catalog
- `research-reports/research_reports/services/news_items.py` — 新增 `normalize_url()`、`title_similarity()`、跨来源去重
- `research-reports/research_reports/services/news_collection.py` — 采集时跨来源 URL 去重
- `research-reports/research_reports/services/scheduler.py` — 新增 `NewsCoordinator`、`BriefingCoordinator`、扩展 `build_scheduler()`
- `research-reports/research_reports/main.py` — 创建协调器、注册调度、挂载 app.state
- `research-reports/research_reports/routes/admin.py` — 协调器异步执行、新增 AI 分类刷新和运行记录接口
- `research-reports/research_reports/models.py` — AIReport 新增 events_json/risks_json
- `research-reports/research_reports/schemas.py` — BriefingPublic 新增 events/risks

### 前端

- `SD/lib/researchReports.ts` — 新增 AI/新闻/早报接口类型和 API 方法
- `SD/pages/AIReportsPage.tsx` — 加载骨架、错误重试、管理员刷新、更新时间、星标/增长/语言展示
- `SD/pages/NewsEventsPage.tsx` — 加载骨架、错误重试、管理员采集、重要性标签、主题标签
- `SD/pages/AIBriefingPage.tsx` — 加载骨架、错误重试、管理员重新生成、模型标签、状态标签、事件/风险结构化展示

## 工作区与提交说明

- 本轮业务改动尚未提交。
- 工作区同时存在 OpenWrite、股票、STM32、主站和研报模块的未提交改动。
- 不应整体暂存或回退工作区。
- `.env.local`、数据库、缓存、日志和 API Key 不应提交到 GitHub。
- 提交前应先执行 `git diff --check`，再按模块精确暂存研报相关文件。

## 下一步建议

1. 在 `.env.local` 配置股票平台模型档案和对应 API Key（或 `SILICONFLOW_API_KEY`）。
2. 调用硅基流动 `/models` 校验 `RESEARCH_REPORTS_AI_MODEL` 是否为真实可用模型 ID。
3. 用真实模型生成一份过去 24 小时早报并检查事件/风险来源引用。

## 第三轮验证记录

- SQLite 旧库迁移完成：`ai_reports` 已包含 `events_json`、`risks_json`。
- 研报后端全量测试：`38 passed`。
- 前端全量测试：`31 passed`。
- 前端 TypeScript 检查：`npm.cmd run lint` 通过。
- 前端生产构建：`npm.cmd run build` 通过。
- 真实 RSS 采集：AI releases 1、AI agents 80、AI companies 77、AI policy 4、Indexed X 7、Indexed Twitter 0，共 232 条新闻记录。
- 修复来源提交后重新采集：数据库已有 6 个 `ContentSource`（其中 2 个 `x_indexed`），`/api/v1/news/social-events?window=24h` 返回 1 条。
- 真实 GitHub Trending 重新采集：综合、Python、JavaScript、TypeScript、Go、Rust 六榜均为 `success`，服务状态恢复为 `ok`。
- 无 AI Key 时真实生成降级早报：状态 `ai_unavailable`，使用 50 条候选，保存 10 条事件和 10 个来源 ID。
- 全站 `scripts/check-local.ps1` 冒烟检查通过。
- 修复 `scripts/stop-local.ps1` 的过期 PID 元数据处理，避免复用 PID 导致停服脚本异常或误杀系统进程。
