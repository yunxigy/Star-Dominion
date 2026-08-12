# GitHub、AI 生态与 AI 早报实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 GitHub 公开榜单长时间无结果，并在现有研报服务中增加 AI 生态榜、公开新闻/社交大事和 DeepSeek V4 Flash AI 早报。

**Architecture:** 继续使用 `research-reports` 独立 FastAPI 服务和 SQLite。公开网页/RSS 采集器只负责抓取和清洗，AI 客户端只负责把已验证候选交给现有站点 AI 配置；每个内容域拥有独立运行记录、锁和失败状态，先落库候选再异步增强。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy、HTTPX、BeautifulSoup、APScheduler、SQLite、React、TypeScript、Vitest、硅基流动 OpenAI 兼容 Chat Completions。

---

## Task 1：先复现并修复 GitHub 榜单阻塞

**Files:**
- Modify: `research-reports/research_reports/collector/github.py`
- Modify: `research-reports/research_reports/services/collections.py`
- Modify: `research-reports/research_reports/services/scheduler.py`
- Modify: `research-reports/research_reports/routes/admin.py`
- Modify: `research-reports/research_reports/schemas.py`
- Test: `research-reports/tests/test_github_client.py`
- Test: `research-reports/tests/test_collection_service.py`
- Test: `research-reports/tests/test_api.py`

- [ ] **Step 1: 写失败测试，证明公开榜单不等待元数据**

```python
def test_public_trending_success_is_persisted_when_metadata_is_forbidden(fake_db):
    collector = FakeCollector(
        trending=[repo("owner/project")],
        metadata_error=GitHubUnavailable("HTTP 403"),
    )
    result = CollectionService(database=fake_db, collector=collector).collect_all(
        trigger="manual", requested_by="admin"
    )
    assert result.categories["all"].status == "success"
    assert result.categories["all"].metadata_delayed is True
    assert load_ranking_names(fake_db, "all") == ["owner/project"]
```

- [ ] **Step 2: 写失败测试，证明单分类有总时限**

让 metadata fake 每次等待 10 秒，注入 `metadata_budget=0.05`，断言采集在预算内完成且状态为 `success` 或 `partial`，不能无限等待。

- [ ] **Step 3: 实现公开页面优先的客户端**

在 `GitHubClient.fetch_trending()` 成功解析并返回后，禁止调用元数据接口作为成功条件。`fetch_metadata()` 保留为可选增强；403、429、连接错误统一转换为 `GitHubUnavailable`，错误文本只保留状态类别，不记录 Token。

- [ ] **Step 4: 实现元数据预算和可恢复队列**

给 `CollectionService` 增加 `metadata_limit: int = 12` 与 `metadata_timeout_seconds: float = 5.0`。每次运行最多补充 12 个仓库；超出部分记录 `metadata_delayed`，下一次运行继续处理。六个分类并行抓取，分类写入完成后再做可选增强。

- [ ] **Step 5: 增加运行阶段字段和 API 输出**

`CollectionRun.categories_json` 每个分类保存 `phase`、`status`、`count`、`metadata_delayed`、`error_type`。管理端详情接口返回阶段，前端不再把整个任务简单显示为“刷新中”。

- [ ] **Step 6: 运行定向测试并提交**

Run: `cd research-reports; python -m pytest tests/test_github_client.py tests/test_collection_service.py tests/test_api.py -q`

Expected: 所有测试通过，且无 Token 时榜单仍能写入。

```powershell
git add research-reports/research_reports/collector/github.py research-reports/research_reports/services/collections.py research-reports/research_reports/services/scheduler.py research-reports/research_reports/routes/admin.py research-reports/research_reports/schemas.py research-reports/tests/test_github_client.py research-reports/tests/test_collection_service.py research-reports/tests/test_api.py
git commit -m "fix(reports): persist GitHub rankings before metadata enrichment"
```

## Task 2：增加 AI 生态分类和数据模型

**Files:**
- Modify: `research-reports/research_reports/models.py`
- Modify: `research-reports/research_reports/database.py`
- Create: `research-reports/research_reports/services/ai_catalog.py`
- Create: `research-reports/research_reports/collector/ai_github.py`
- Test: `research-reports/tests/test_ai_catalog.py`
- Test: `research-reports/tests/test_ai_github.py`

- [ ] **Step 1: 写失败测试，锁定分类和解释**

```python
def test_classify_ai_repository_prefers_topics_over_description():
    result = classify_repository(
        name="skill-server",
        description="A general automation tool",
        topics=["mcp", "ai-agent"],
    )
    assert result.primary_category == "mcp"
    assert "topic:mcp" in result.reasons
```

测试负向词：课程、教程、数据集镜像不得直接排到 AI 应用榜第一；同一仓库可以有多个分类，但只能有一个主分类。

- [ ] **Step 2: 创建 AI 生态实体**

增加 `AICatalogEntry` 和 `AICatalogRun`，字段覆盖仓库 ID、分类、命中原因、分数、来源期数、状态、运行时间和错误摘要。沿用现有 `Base` 和 `create_all()`，不引入新的迁移服务。

- [ ] **Step 3: 实现关键词打分器**

在 `ai_catalog.py` 固定六组词表：`agent_skill`、`mcp`、`llm_rag`、`computer_use`、`ai_app`、`ai_infra`。topics 命中分值 5，仓库名命中分值 3，描述命中分值 1，负向词扣 2；返回排序后的分类、分数和解释。

- [ ] **Step 4: 从 GitHub 公开榜单生成 AI 榜**

复用 `GitHubClient.fetch_trending()` 的公开 HTML 结果，去重后调用分类器，写入最多每类 50 条。GitHub REST 失败不能影响 AI 分类，因为基础字段来自 Trending 页面。

- [ ] **Step 5: 运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_ai_catalog.py tests/test_ai_github.py -q`

```powershell
git add research-reports/research_reports/models.py research-reports/research_reports/database.py research-reports/research_reports/services/ai_catalog.py research-reports/research_reports/collector/ai_github.py research-reports/tests/test_ai_catalog.py research-reports/tests/test_ai_github.py
git commit -m "feat(reports): add GitHub AI ecosystem catalog"
```

## Task 3：实现公开 RSS 和新闻/社交事件采集

**Files:**
- Modify: `research-reports/research_reports/models.py`
- Create: `research-reports/research_reports/collector/rss.py`
- Create: `research-reports/research_reports/collector/news_queries.py`
- Create: `research-reports/research_reports/services/news_items.py`
- Test: `research-reports/tests/test_rss_collector.py`
- Test: `research-reports/tests/test_news_items.py`

- [ ] **Step 1: 写 RSS 解析失败测试**

使用本地 XML fixture 验证标题、URL、发布时间、发布者、描述、来源类型和内容哈希；缺失时间或非法 URL 的条目被跳过，不让整个源失败。

- [ ] **Step 2: 添加 `ContentSource` 和 `NewsItem`**

`ContentSource` 保存源配置和最近错误；`NewsItem` 保存规范化 URL、标题、摘要、发布时间、来源、主题、重要性和哈希。唯一约束使用 `(source_id, content_hash)`，避免重复抓取。

- [ ] **Step 3: 实现 RSS 源配置**

默认源：AI 新闻、LLM、AI Agent、芯片、模型发布、`site:x.com`、`site:twitter.com`。每个源具有 URL、主题、最大条目数和 10 秒超时。源配置从代码默认值加载，可通过 `RESEARCH_REPORTS_RSS_CONFIG` 指向 JSON 配置覆盖。

- [ ] **Step 4: 实现过去 24 小时筛选和事件聚类**

将标题和摘要规范化后按 URL、内容哈希和标题相似度去重；发布时间不在 `now - 24h` 到 `now + 10m` 范围内的条目不进入早报候选。社交条目标记为 `x_indexed`，新闻报道标记为 `news_report`。

- [ ] **Step 5: 运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_rss_collector.py tests/test_news_items.py -q`

```powershell
git add research-reports/research_reports/models.py research-reports/research_reports/collector/rss.py research-reports/research_reports/collector/news_queries.py research-reports/research_reports/services/news_items.py research-reports/tests/test_rss_collector.py research-reports/tests/test_news_items.py
git commit -m "feat(reports): collect public AI news and social events"
```

## Task 4：接入硅基流动 DeepSeek V4 Flash

**Files:**
- Create: `research-reports/research_reports/ai_client.py`
- Create: `research-reports/research_reports/services/briefings.py`
- Modify: `research-reports/research_reports/config.py`
- Modify: `.env.local.example`
- Test: `research-reports/tests/test_ai_client.py`
- Test: `research-reports/tests/test_briefings.py`

- [ ] **Step 1: 写失败测试，验证 OpenAI 兼容请求格式**

```python
def test_deepseek_client_posts_openai_compatible_payload(mock_http):
    client = SiliconFlowClient(
        http=mock_http,
        base_url="https://api.siliconflow.cn/v1",
        api_key="secret",
        model="deepseek-v4-flash",
    )
    result = client.generate(system="只基于资料", user="资料")
    assert result.text
    request = mock_http.requests[0]
    assert request.url.path == "/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer secret"
```

- [ ] **Step 2: 配置模型和超时**

增加 `RESEARCH_REPORTS_AI_PROVIDER=siliconflow`、`RESEARCH_REPORTS_AI_BASE_URL=https://api.siliconflow.cn/v1`、`RESEARCH_REPORTS_AI_MODEL=deepseek-v4-flash`、`SILICONFLOW_API_KEY=`、`RESEARCH_REPORTS_AI_TIMEOUT_SECONDS=45`。模型 ID 可在 `.env.local` 覆盖，代码不写死供应商私有路径。

- [ ] **Step 3: 实现候选资料到早报的 Prompt**

`BriefingService.generate()` 只把经过清洗的候选条目发送给模型，并要求输出严格 JSON：`title`、`summary`、`events[]`、`risks[]`、`source_ids[]`。校验 source ID 必须来自输入集合；JSON 无法解析或引用不存在时标记 `ai_unavailable`。

- [ ] **Step 4: 实现降级结果**

模型调用失败时保存规则摘要：按重要性排序展示最多 10 条候选，早报状态为 `ai_unavailable`，错误只记录供应商状态类别，不记录 API Key 和完整响应。

- [ ] **Step 5: 运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_ai_client.py tests/test_briefings.py -q`

```powershell
git add research-reports/research_reports/ai_client.py research-reports/research_reports/services/briefings.py research-reports/research_reports/config.py .env.local.example research-reports/tests/test_ai_client.py research-reports/tests/test_briefings.py
git commit -m "feat(reports): generate AI briefings with SiliconFlow"
```

## Task 5：增加调度、API 和统一认证

**Files:**
- Modify: `research-reports/research_reports/services/scheduler.py`
- Modify: `research-reports/research_reports/main.py`
- Modify: `research-reports/research_reports/routes/public.py`
- Modify: `research-reports/research_reports/routes/admin.py`
- Modify: `research-reports/research_reports/schemas.py`
- Test: `research-reports/tests/test_scheduler.py`
- Test: `research-reports/tests/test_api.py`

- [ ] **Step 1: 写调度边界测试**

验证：整点 GitHub、每 30 分钟新闻、每天 08:30 早报；不同域可并行，同域重复触发返回 `409`；启动时创建当天早报记录但不重复生成。

- [ ] **Step 2: 实现三类协调器**

在 `CollectionCoordinator` 之外增加 `NewsCoordinator`、`BriefingCoordinator`，每个协调器使用自己的 `Lock`、运行记录和 executor。GitHub、AI 生态可共享公开页面请求，但不能共享会导致互相阻塞的锁。

- [ ] **Step 3: 添加公开 API**

实现 `/api/v1/ai/rankings`、`/api/v1/news`、`/api/v1/news/social-events`、`/api/v1/briefings`、`/api/v1/content-sources`，统一分页、时间窗和来源字段。

- [ ] **Step 4: 添加管理员 API**

实现 `/api/v1/admin/collections/github`、`/api/v1/admin/collections/ai`、`/api/v1/admin/collections/news`、`/api/v1/admin/briefings/generate` 和运行记录查询；全部复用当前 `SiteAuthClient` 的管理员依赖、Origin 和 CSRF。

- [ ] **Step 5: 运行 API 测试并提交**

Run: `cd research-reports; python -m pytest tests/test_scheduler.py tests/test_api.py -q`

```powershell
git add research-reports/research_reports/services/scheduler.py research-reports/research_reports/main.py research-reports/research_reports/routes/public.py research-reports/research_reports/routes/admin.py research-reports/research_reports/schemas.py research-reports/tests/test_scheduler.py research-reports/tests/test_api.py
git commit -m "feat(reports): schedule and expose AI news domains"
```

## Task 6：实现研报前端四个页面

**Files:**
- Modify: `SD/lib/researchReports.ts`
- Modify: `SD/App.tsx`
- Modify: `SD/pages/ReportsPage.tsx`
- Create: `SD/pages/AIReportsPage.tsx`
- Create: `SD/pages/NewsEventsPage.tsx`
- Create: `SD/pages/AIBriefingPage.tsx`
- Create: `SD/components/reports/AICatalogList.tsx`
- Create: `SD/components/reports/NewsTimeline.tsx`
- Create: `SD/components/reports/BriefingArticle.tsx`
- Test: `SD/lib/researchReports.test.ts`
- Test: `SD/components/reports/AIReportsPage.test.tsx`
- Test: `SD/components/reports/NewsEventsPage.test.tsx`
- Test: `SD/components/reports/AIBriefingPage.test.tsx`

- [ ] **Step 1: 扩展 API 类型和 URL 测试**

为 AI 榜、新闻、来源、早报和采集运行记录定义 TypeScript 类型；测试 `window=24h`、category、source 和管理员 POST 的 URL 与 CSRF 行为。

- [ ] **Step 2: 实现 AI 生态页面**

增加分类 Tab、命中原因、分数、Star 增长、项目链接和数据更新时间；空数据时显示“等待公开源更新”，不显示假数据。

- [ ] **Step 3: 实现新闻大事页**

按时间倒序展示来源、来源类型、主题、摘要和原文链接；增加 24 小时/6 小时切换、来源过滤和关键词搜索。

- [ ] **Step 4: 实现 AI 早报页**

展示生成状态、模型名、生成时间、正文、引用来源和降级提示；管理员可重新生成，普通用户没有写入按钮。

- [ ] **Step 5: 接入主站路由和导航**

注册 `/reports/ai`、`/reports/news`、`/reports/briefing`，首页研报入口指向入口页，入口页显示四个内容域卡片。

- [ ] **Step 6: 运行前端测试和构建并提交**

Run: `cd SD; npm test; npm run lint; npm run build`

```powershell
git add SD/lib/researchReports.ts SD/App.tsx SD/pages/ReportsPage.tsx SD/pages/AIReportsPage.tsx SD/pages/NewsEventsPage.tsx SD/pages/AIBriefingPage.tsx SD/components/reports SD/lib/researchReports.test.ts
git commit -m "feat(reports): add AI ecosystem news and briefing pages"
```

## Task 7：接入配置、运行脚本、文档和验收

**Files:**
- Modify: `scripts/start-local.ps1`
- Modify: `scripts/check-local.ps1`
- Modify: `.env.local.example`
- Modify: `.gitignore`
- Modify: `nginx.conf`
- Modify: `research-reports/README.md`
- Modify: `README.md`
- Test: `research-reports/tests/test_workspace_integration.py`

- [ ] **Step 1: 增加环境变量和忽略规则**

补充硅基流动配置、RSS 配置、运行预算；确保 `.env.local`、`research-reports/data/`、原始源缓存和日志均被忽略。

- [ ] **Step 2: 扩展启动和检查脚本**

启动脚本继续使用 8009；检查脚本验证 `/health`、四个公开内容接口、匿名管理员 401、管理员读取运行记录 200；不自动触发真实 AI 生成。

- [ ] **Step 3: 更新 Nginx 和文档**

增加 `/reports-api/` 代理，文档写明无 GitHub/X Token 也可运行、硅基流动 Key 的配置位置、公开源覆盖范围和 X 内容的可索引限制。

- [ ] **Step 4: 运行全量验证**

Run these commands from the repository root:

```powershell
Push-Location .\research-reports
python -m pytest tests -q
python -m compileall -q research_reports
Pop-Location
Push-Location .\SD
npm test
npm run lint
npm run build
Pop-Location
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-local.ps1
```

预期：后端、前端测试通过，8000–8009 和三个前端端口启动，所有公开 API 返回 200，管理员写入接口在未登录时返回 401。

- [ ] **Step 5: 真实采集验收**

先触发 GitHub 和 RSS 采集，确认榜单/候选先落库；再使用统一管理员会话触发 AI 早报，确认成功时包含 source IDs，失败时显示 `ai_unavailable` 而不是伪造正文。

- [ ] **Step 6: Commit**

```powershell
git add scripts/start-local.ps1 scripts/check-local.ps1 .env.local.example .gitignore nginx.conf research-reports/README.md README.md research-reports/tests/test_workspace_integration.py
git commit -m "feat(reports): integrate AI news domains into local stack"
```

## 自审清单

- GitHub Token 不是必需配置，公开 Trending 成功即可生成榜单。
- GitHub REST 403 不会阻塞 `RankingEntry` 写入；元数据预算、阶段和错误类型均有测试任务。
- AI 生态、新闻大事、AI 早报均有独立数据实体、运行记录、锁和 API。
- DeepSeek 调用失败有规则降级，不会输出未引用事实。
- 公开 X 内容的覆盖限制写入设计、页面和 README。
- 所有任务都有具体文件、测试命令和提交边界，没有依赖未定义的函数或未明确的步骤。
