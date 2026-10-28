# GitHub 周榜研报服务

这是一个独立 FastAPI 服务，为主站 `/reports` 提供 GitHub Trending 周榜。它维护综合榜以及 Python、JavaScript、TypeScript、Go、Rust 分榜，公开页面可以直接浏览；手动采集与采集日志复用全站管理员登录。

## 本地运行

在仓库根目录的 `平台管理/` 中配置 `.env.local` 后，推荐随全站启动：

```powershell
.\平台管理\scripts\start-local.ps1
.\平台管理\scripts\check-local.ps1
```

单独运行服务：

```powershell
Push-Location .\research-reports
python -m pip install -e ".[dev]"
python -m uvicorn research_reports.main:create_app --factory --host 127.0.0.1 --port 8009
Pop-Location
```

主站通过 `/reports-api` 代理访问服务，页面地址为 `http://127.0.0.1:8013/reports`。

## 配置

- `RESEARCH_REPORTS_DATA_DIR`：SQLite 数据目录，默认 `research-reports/data`。
- `RESEARCH_REPORTS_TIMEZONE`：调度时区，默认 `Asia/Shanghai`。
- `RESEARCH_REPORTS_SITE_AUTH_URL`：统一认证服务地址。
- `SITE_AUTH_INTERNAL_KEY`：与全站认证相同的内部服务密钥，至少 32 个字符。
- `GITHUB_TOKEN`：可选。留空仍可抓取 Trending；配置后可提高 GitHub 元数据接口限额。
- `RESEARCH_REPORTS_HOST`、`RESEARCH_REPORTS_PORT`：默认 `127.0.0.1:8009`。

真实密钥只写入已忽略的 `.env.local`，不要提交到 Git。

## 调度规则

- 每小时整点采集一次当前周榜。
- 每周一 08:30（Asia/Shanghai）建立新一期，再继续写入新一期榜单。
- 单个语言采集失败时保留该语言的上一份有效榜单，其他分类仍会更新。
- 管理员可在研报页面手动刷新；同一时间只允许一个采集任务运行。

## 测试

```powershell
Push-Location .\research-reports
python -m pytest tests -q
python -m compileall -q research_reports
Pop-Location
```

## AI 早报与统一模型配置

研报服务优先复用股票模块的 `STOCK_PLATFORM_MODEL_PROFILES_JSON`：选择指定的
`RESEARCH_REPORTS_AI_PROFILE_ID`，或自动选择第一个启用的 SiliconFlow 平台档案，
并从档案的 `api_key_env` 读取同一份服务端 Key。未配置平台档案时，兼容读取
`SILICONFLOW_API_KEY`、`RESEARCH_REPORTS_AI_BASE_URL` 和 `RESEARCH_REPORTS_AI_MODEL`。

```powershell
$env:STOCK_PLATFORM_MODEL_PROFILES_JSON='[{"id":"platform-sf","name":"硅基流动","provider":"siliconflow","base_url":"https://api.siliconflow.cn/v1","api_key_env":"STOCK_SILICONFLOW_API_KEY"}]'
$env:STOCK_SILICONFLOW_API_KEY='<server-only-key>'
$env:RESEARCH_REPORTS_AI_PROFILE_ID='platform-sf'
$env:RESEARCH_REPORTS_AI_MODEL='deepseek-v4-flash'
```

`GET /models` 的模型目录校验由 `SiliconFlowClient.list_models()` 提供。没有 Key 时不会伪造早报，服务会保存 `ai_unavailable` 候选摘要并保留来源 ID。

调度规则：GitHub 榜单每小时整点采集；每周一 08:30 换榜；公开新闻每 30 分钟采集；AI 早报每天 08:30 生成。新闻和早报使用独立锁与运行记录，重复触发会被安全跳过。

## AI 圈大事写入接口

Cloudflare Worker 负责读取 X 公开动态并调用 Gemini；本服务只负责校验、幂等保存和向前端提供最新批次。Worker 与本服务之间通过 HTTPS 发送数据，Gemini Key 不会经过本服务或浏览器。

在 `平台管理/.env.local` 配置 `RESEARCH_REPORTS_X_INGEST_TOKEN`，并在 Cloudflare Worker 的 `SITE_PUSH_TOKEN` 中配置同一个随机强 Token。该项可留空，不影响旧功能；未配置时写入接口会 fail closed 并返回 503。请勿把 Token 放入前端变量或提交到 Git。

- `POST /api/v1/ingest/x`：需要 `Authorization: Bearer <token>` 和 `X-Idempotency-Key`；只接受 HTTPS 原文链接，单批请求体上限 1 MiB。数据验证、动态写入和报告写入在同一个 SQLite 事务中完成。
- `GET /api/v1/x-events/latest`：公开读取最新一次 Gemini 批次及其关联动态；空库返回 `{"report":null,"posts":[]}`。它与旧的 `/api/v1/news/social-events` 是不同数据源，前端“社交大事”使用这个专属摘要接口。

相同幂等键重试不会新增报告；跨批次出现相同 `provider + external_id` 时不会重复保存动态。Worker 收到写入成功后才提交对应账号的采集游标。服务的 `/reports-api` 代理和 8009 端口沿用现有配置，不需要新增 Nginx 或 Vite 代理。
