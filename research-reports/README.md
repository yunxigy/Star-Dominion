# GitHub 周榜研报服务

这是一个独立 FastAPI 服务，为主站 `/reports` 提供 GitHub Trending 周榜。它维护综合榜以及 Python、JavaScript、TypeScript、Go、Rust 分榜，公开页面可以直接浏览；手动采集与采集日志复用全站管理员登录。

## 本地运行

在仓库根目录配置 `.env.local` 后，推荐随全站启动：

```powershell
.\scripts\start-local.ps1
.\scripts\check-local.ps1
```

单独运行服务：

```powershell
Push-Location .\research-reports
python -m pip install -e ".[dev]"
python -m uvicorn research_reports.main:create_app --factory --host 127.0.0.1 --port 8009
Pop-Location
```

主站通过 `/reports-api` 代理访问服务，页面地址为 `http://127.0.0.1:5173/reports`。

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
