# GitHub 周榜研报模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个监听 8009 的独立研报服务和主站研报页面，每小时更新 GitHub 综合及 Python、JavaScript、TypeScript、Go、Rust 周榜，并在每周一 08:30 建立新一期。

**Architecture:** `research-reports/` 负责 GitHub Trending 采集、元数据缓存、SQLite 持久化、调度和公开/管理员 API；`SD` 只通过 `/reports-api/` 消费这些 API。所有写操作复用 `site-auth` Cookie 与 CSRF 校验，采集失败保留最近成功结果。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy 2、HTTPX、BeautifulSoup4、APScheduler、SQLite、Pytest；React 18、TypeScript、Vite、Vitest、Tailwind CSS、Lucide React。

---

## 文件结构

### 新建后端

- `research-reports/pyproject.toml`：依赖、包发现和 Pytest 配置。
- `research-reports/research_reports/config.py`：环境变量校验和路径解析。
- `research-reports/research_reports/database.py`：SQLAlchemy 引擎、会话和建表入口。
- `research-reports/research_reports/models.py`：仓库、周刊、榜单、小时观测和采集运行模型。
- `research-reports/research_reports/schemas.py`：公开 API 和管理员 API 的 Pydantic 类型。
- `research-reports/research_reports/collector/types.py`：采集器内部不可变数据类型。
- `research-reports/research_reports/collector/parser.py`：GitHub Trending HTML 解析。
- `research-reports/research_reports/collector/github.py`：HTTP 请求、重试、ETag 和元数据补全。
- `research-reports/research_reports/services/rankings.py`：跨周状态和摘要计算。
- `research-reports/research_reports/services/collections.py`：六分类采集编排与事务写入。
- `research-reports/research_reports/services/scheduler.py`：小时轮询、周一换榜和互斥。
- `research-reports/research_reports/site_auth.py`：调用统一认证内部验证接口。
- `research-reports/research_reports/routes/public.py`：公开读取接口。
- `research-reports/research_reports/routes/admin.py`：管理员刷新与采集日志接口。
- `research-reports/research_reports/main.py`：应用工厂和生命周期。
- `research-reports/tests/fixtures/trending_weekly.html`：稳定的解析测试样本。
- `research-reports/tests/` 下各测试文件：单元、API 和调度测试。

### 新建前端

- `SD/lib/researchReports.ts`：研报 API 类型和请求函数。
- `SD/lib/researchReports.test.ts`：查询参数与错误映射测试。
- `SD/pages/ReportsPage.tsx`：研报入口页。
- `SD/pages/GitHubReportsPage.tsx`：GitHub 周榜容器和状态管理。
- `SD/components/reports/ReportHeader.tsx`：周期与数据健康状态。
- `SD/components/reports/ReportFilters.tsx`：分类、搜索、许可证和状态筛选。
- `SD/components/reports/RankingList.tsx`：桌面榜单和移动卡片。
- `SD/components/reports/AdminCollectionPanel.tsx`：管理员刷新和运行状态。
- `SD/components/reports/reportViewModel.ts`：纯前端展示转换。
- `SD/components/reports/reportViewModel.test.ts`：标记、数字和时间展示测试。

### 修改集成文件

- `SD/App.tsx`：注册 `/reports` 和 `/reports/github`。
- `SD/pages/HomePage.tsx`：增加研报入口卡片。
- `SD/vite.config.ts`：增加 `/reports-api` 代理。
- `scripts/start-local.ps1`：管理 8009 服务。
- `scripts/check-local.ps1`：增加公开和管理员冒烟检查。
- `.env.local.example`：列出安全的研报配置名。
- `.gitignore`：忽略研报运行数据。
- `nginx.conf`：增加生产 `/reports-api/` 代理。
- `README.md`：补充研报模块和启动说明。

实施时不得整体重写当前已修改的 `SD/App.tsx`、`SD/pages/HomePage.tsx`、`SD/vite.config.ts`、`README.md` 或 `nginx.conf`。每次只用精确补丁加入本计划内容，并在暂存前检查 `git diff -- <file>`。

---

### Task 1：建立独立服务配置和数据库模型

**Files:**
- Create: `research-reports/pyproject.toml`
- Create: `research-reports/research_reports/__init__.py`
- Create: `research-reports/research_reports/config.py`
- Create: `research-reports/research_reports/database.py`
- Create: `research-reports/research_reports/models.py`
- Create: `research-reports/tests/test_config_and_models.py`

- [ ] **Step 1：先写配置和唯一约束测试**

```python
from pathlib import Path

from sqlalchemy import select

from research_reports.config import Settings
from research_reports.database import create_database
from research_reports.models import WeeklyIssue


def test_settings_resolve_data_dir_and_optional_token(tmp_path: Path) -> None:
    settings = Settings.from_env({
        "RESEARCH_REPORTS_DATA_DIR": str(tmp_path),
        "RESEARCH_REPORTS_TIMEZONE": "Asia/Shanghai",
        "RESEARCH_REPORTS_SITE_AUTH_URL": "http://127.0.0.1:8000",
        "SITE_AUTH_INTERNAL_KEY": "k" * 32,
    })
    assert settings.database_path == tmp_path.resolve() / "reports.db"
    assert settings.github_token is None


def test_weekly_issue_is_unique_by_iso_week(tmp_path: Path) -> None:
    database = create_database(tmp_path / "reports.db")
    with database.sessions() as session:
        session.add(WeeklyIssue(iso_year=2026, iso_week=31, status="collecting"))
        session.commit()
        assert session.scalar(select(WeeklyIssue)).iso_week == 31
```

- [ ] **Step 2：运行测试并确认导入失败**

Run: `cd research-reports; python -m pytest tests/test_config_and_models.py -q`

Expected: FAIL，提示 `ModuleNotFoundError: No module named 'research_reports'`。

- [ ] **Step 3：创建最小项目和配置实现**

`pyproject.toml` 使用以下依赖边界：

```toml
[project]
name = "dream-chaser-research-reports"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "apscheduler>=3.10,<4",
  "beautifulsoup4>=4.12,<5",
  "fastapi>=0.115,<1",
  "httpx>=0.27,<1",
  "pydantic>=2.8,<3",
  "sqlalchemy>=2.0,<3",
  "uvicorn>=0.30,<1",
]

[project.optional-dependencies]
dev = ["pytest>=8,<9"]

[tool.setuptools.packages.find]
include = ["research_reports*"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

`Settings` 必须是不可变 dataclass，至少暴露：

```python
@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    timezone: ZoneInfo
    site_auth_url: str
    site_auth_internal_key: str
    github_token: str | None

    @property
    def database_path(self) -> Path:
        return self.data_dir / "reports.db"
```

`Settings.from_env()` 必须拒绝少于 32 字符的 `SITE_AUTH_INTERNAL_KEY`，并对 `GITHUB_TOKEN` 使用 `repr=False` 字段。

- [ ] **Step 4：实现模型和数据库工厂**

`models.py` 定义 `Repository`、`WeeklyIssue`、`RankingEntry`、`HourlyObservation`、`CollectionRun`，并落实规格中的三个唯一约束：

```python
__table_args__ = (UniqueConstraint("iso_year", "iso_week", name="uq_weekly_issue"),)
```

```python
__table_args__ = (
    UniqueConstraint("issue_id", "category", "repository_id", name="uq_ranking_entry"),
)
```

```python
__table_args__ = (
    UniqueConstraint(
        "issue_id", "repository_id", "category", "observed_at",
        name="uq_hourly_observation",
    ),
)
```

使用 `DateTime(timezone=True)` 保存时间，JSON 数组先使用 SQLAlchemy `JSON`，不把 Topics 拼成逗号字符串。

- [ ] **Step 5：运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_config_and_models.py -q`

Expected: `2 passed`。

```powershell
git add -- research-reports/pyproject.toml research-reports/research_reports research-reports/tests/test_config_and_models.py
git commit -m "feat(reports): add standalone data model"
```

---

### Task 2：解析 GitHub Trending 周榜

**Files:**
- Create: `research-reports/research_reports/collector/__init__.py`
- Create: `research-reports/research_reports/collector/types.py`
- Create: `research-reports/research_reports/collector/parser.py`
- Create: `research-reports/tests/fixtures/trending_weekly.html`
- Create: `research-reports/tests/test_trending_parser.py`

- [ ] **Step 1：创建包含两个仓库的 HTML 样本**

样本必须包含 `article.Box-row`、仓库链接、简介、主语言、总 Star、Fork、本周 Star 和贡献者头像，并包含 `1,234` 千位分隔格式。第二个仓库省略简介和语言，用于验证可选字段。

- [ ] **Step 2：先写解析行为测试**

```python
from pathlib import Path

import pytest

from research_reports.collector.parser import TrendingParseError, parse_trending


FIXTURE = Path(__file__).parent / "fixtures" / "trending_weekly.html"


def test_parse_weekly_trending_rows() -> None:
    rows = parse_trending(FIXTURE.read_text(encoding="utf-8"), category="python")
    assert [row.rank for row in rows] == [1, 2]
    assert rows[0].full_name == "owner/alpha"
    assert rows[0].stars_total == 1234
    assert rows[0].stars_since_weekly == 456
    assert rows[0].category == "python"
    assert rows[1].description is None


def test_empty_trending_page_is_rejected() -> None:
    with pytest.raises(TrendingParseError, match="no repository rows"):
        parse_trending("<html></html>", category="all")
```

- [ ] **Step 3：运行测试并确认失败**

Run: `cd research-reports; python -m pytest tests/test_trending_parser.py -q`

Expected: FAIL，提示 `research_reports.collector.parser` 不存在。

- [ ] **Step 4：实现不可变采集类型和解析器**

```python
@dataclass(frozen=True, slots=True)
class TrendingRepository:
    category: str
    rank: int
    full_name: str
    description: str | None
    primary_language: str | None
    stars_total: int
    forks_total: int
    stars_since_weekly: int
    contributor_urls: tuple[str, ...]
    html_url: str
```

`parse_trending(html, category)` 必须：

1. 只遍历 `article.Box-row`。
2. 将仓库路径规范为恰好两个非空片段。
3. 只生成 `https://github.com/{owner}/{repo}` 链接。
4. 使用独立 `_parse_count()` 处理逗号和空白。
5. 没有任何有效行时抛出 `TrendingParseError`。

- [ ] **Step 5：运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_trending_parser.py -q`

Expected: `2 passed`。

```powershell
git add -- research-reports/research_reports/collector research-reports/tests/fixtures research-reports/tests/test_trending_parser.py
git commit -m "feat(reports): parse GitHub weekly trending"
```

---

### Task 3：实现 GitHub HTTP 客户端与元数据缓存语义

**Files:**
- Create: `research-reports/research_reports/collector/github.py`
- Create: `research-reports/tests/test_github_client.py`

- [ ] **Step 1：写失败、重试和 Token 隐私测试**

使用 `httpx.MockTransport` 测试：

```python
def test_fetch_category_uses_weekly_url_and_user_agent() -> None:
    requested = []
    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request)
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))
    client = GitHubClient(http=httpx.Client(transport=httpx.MockTransport(handler)))
    rows = client.fetch_trending("python")
    assert rows[0].category == "python"
    assert requested[0].url.path == "/trending/python"
    assert requested[0].url.params["since"] == "weekly"
    assert requested[0].headers["User-Agent"] == "dream-chaser-research-reports/0.1"
```

再覆盖 429 后成功、连续 5xx 后抛 `GitHubUnavailable`、元数据 304 复用缓存，以及异常字符串不包含 Token。

- [ ] **Step 2：运行测试并确认失败**

Run: `cd research-reports; python -m pytest tests/test_github_client.py -q`

Expected: FAIL，提示 `GitHubClient` 无法导入。

- [ ] **Step 3：实现客户端**

```python
class GitHubClient:
    def __init__(
        self,
        *,
        http: httpx.Client,
        token: str | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None: ...

    def fetch_trending(self, category: str) -> list[TrendingRepository]: ...

    def fetch_metadata(
        self,
        full_name: str,
        *,
        etag: str | None,
    ) -> RepositoryMetadata | NotModified: ...
```

只允许 `all`、`python`、`javascript`、`typescript`、`go`、`rust`；重试等待固定为 0.5、1、2 秒并可注入 `sleeper`，测试不得真实等待。元数据请求携带可选 `If-None-Match`，Token 只进入 `Authorization` 请求头。

- [ ] **Step 4：运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_github_client.py -q`

Expected: 全部 PASS。

```powershell
git add -- research-reports/research_reports/collector/github.py research-reports/tests/test_github_client.py
git commit -m "feat(reports): add resilient GitHub collector"
```

---

### Task 4：实现跨周排名状态与摘要

**Files:**
- Create: `research-reports/research_reports/services/__init__.py`
- Create: `research-reports/research_reports/services/rankings.py`
- Create: `research-reports/tests/test_rankings.py`

- [ ] **Step 1：先写纯函数测试**

```python
def test_classify_ranking_statuses() -> None:
    history = {"a/alpha": [3], "b/beta": [1, 2]}
    assert classify_status("c/new", current_rank=1, previous_rank=None, history=history) == "new"
    assert classify_status("b/beta", current_rank=1, previous_rank=2, history=history) == "rising"
    assert classify_status("a/alpha", current_rank=5, previous_rank=None, history=history) == "returned"


def test_summary_selects_fastest_growth_with_rank_tiebreak() -> None:
    summary = summarize([
        EntryView(full_name="a/a", rank=2, stars_since_weekly=500, status="rising"),
        EntryView(full_name="b/b", rank=1, stars_since_weekly=500, status="new"),
    ])
    assert summary.fastest_growth_full_name == "b/b"
    assert summary.new_count == 1
```

- [ ] **Step 2：运行测试并确认失败**

Run: `cd research-reports; python -m pytest tests/test_rankings.py -q`

Expected: FAIL，提示排名函数不存在。

- [ ] **Step 3：实现无数据库副作用的排名函数**

`classify_status()`、`consecutive_weeks()`、`hourly_delta()` 和 `summarize()` 必须只接收值对象并返回值对象。状态优先级固定为 `new/returned`，其次才是 `rising/falling/steady`。

- [ ] **Step 4：运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_rankings.py -q`

Expected: 全部 PASS。

```powershell
git add -- research-reports/research_reports/services research-reports/tests/test_rankings.py
git commit -m "feat(reports): calculate weekly ranking signals"
```

---

### Task 5：实现采集编排与安全写入

**Files:**
- Create: `research-reports/research_reports/services/collections.py`
- Create: `research-reports/tests/test_collection_service.py`

- [ ] **Step 1：写部分失败不覆盖旧榜测试**

构造一个 Python 成功、Rust 抛异常的 fake collector，并在数据库中预置 Rust 旧榜：

```python
result = service.collect_all(trigger="scheduled_hourly", requested_by=None)
assert result.status == "partial"
assert result.categories["python"].status == "success"
assert result.categories["rust"].status == "failed"
assert load_current_names(session, "rust") == ["old/rust-project"]
assert load_current_names(session, "python") == ["new/python-project"]
```

再验证同一 `observed_at` 重跑不会增加 `HourlyObservation` 数量，空解析结果不会先删除旧数据。

- [ ] **Step 2：运行测试并确认失败**

Run: `cd research-reports; python -m pytest tests/test_collection_service.py -q`

Expected: FAIL，提示 `CollectionService` 不存在。

- [ ] **Step 3：实现编排器**

```python
CATEGORIES = ("all", "python", "javascript", "typescript", "go", "rust")

class CollectionService:
    def collect_all(
        self,
        *,
        trigger: str,
        requested_by: str | None,
        observed_at: datetime | None = None,
    ) -> CollectionResult: ...
```

每个分类按以下顺序执行：抓取并完整解析、校验至少一条、开启短事务、upsert `Repository`、upsert `RankingEntry`、insert-or-ignore `HourlyObservation`、提交。失败分类回滚自己的事务并保留旧数据。`CollectionRun.error_summary` 只保存异常类型和不含敏感值的短消息。

元数据补全必须在 Trending 榜成功写入之后按缓存到期顺序执行；元数据失败不改变分类的榜单成功状态，但在分类结果中记录 `metadata_delayed`。

- [ ] **Step 4：运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_collection_service.py -q`

Expected: 全部 PASS。

```powershell
git add -- research-reports/research_reports/services/collections.py research-reports/tests/test_collection_service.py
git commit -m "feat(reports): persist partial-safe collections"
```

---

### Task 6：实现研报周边界和调度器

**Files:**
- Create: `research-reports/research_reports/services/scheduler.py`
- Create: `research-reports/tests/test_scheduler.py`

- [ ] **Step 1：写周一 08:30 边界测试**

```python
@pytest.mark.parametrize(
    ("now", "expected_week"),
    [
        (datetime(2026, 8, 3, 8, 29, tzinfo=SHANGHAI), 31),
        (datetime(2026, 8, 3, 8, 30, tzinfo=SHANGHAI), 32),
    ],
)
def test_reporting_week_changes_only_at_monday_0830(now, expected_week) -> None:
    assert reporting_week(now).week == expected_week
```

再写：重复 rollover 只产生一期；进程锁被占用时自动任务记录 `skipped_overlap`；服务跨周启动补建正确一期。

- [ ] **Step 2：运行测试并确认失败**

Run: `cd research-reports; python -m pytest tests/test_scheduler.py -q`

Expected: FAIL，提示 `reporting_week` 不存在。

- [ ] **Step 3：实现边界函数与协调器**

```python
@dataclass(frozen=True, slots=True)
class ReportingWeek:
    year: int
    week: int
    boundary: datetime


def reporting_week(now: datetime, timezone: ZoneInfo) -> ReportingWeek: ...


class CollectionCoordinator:
    def trigger(self, *, trigger: str, requested_by: str | None) -> TriggerResult: ...
    def rollover(self, now: datetime) -> TriggerResult: ...
```

协调器使用 `threading.Lock.acquire(blocking=False)`。APScheduler 注册：

```python
scheduler.add_job(coordinator.hourly, "cron", minute=0, id="hourly", max_instances=1)
scheduler.add_job(
    coordinator.weekly_rollover,
    "cron",
    day_of_week="mon",
    hour=8,
    minute=30,
    id="weekly-rollover",
    max_instances=1,
)
```

调度器显式使用 `Asia/Shanghai`，服务启动时调用 `ensure_active_issue(now)`。

- [ ] **Step 4：运行测试并提交**

Run: `cd research-reports; python -m pytest tests/test_scheduler.py -q`

Expected: 全部 PASS。

```powershell
git add -- research-reports/research_reports/services/scheduler.py research-reports/tests/test_scheduler.py
git commit -m "feat(reports): schedule hourly and weekly collections"
```

---

### Task 7：实现统一认证和研报 API

**Files:**
- Create: `research-reports/research_reports/site_auth.py`
- Create: `research-reports/research_reports/schemas.py`
- Create: `research-reports/research_reports/routes/__init__.py`
- Create: `research-reports/research_reports/routes/public.py`
- Create: `research-reports/research_reports/routes/admin.py`
- Create: `research-reports/research_reports/main.py`
- Create: `research-reports/tests/conftest.py`
- Create: `research-reports/tests/test_api.py`

- [ ] **Step 1：写公开读取和管理员权限测试**

```python
def test_public_rankings_do_not_require_login(client: TestClient) -> None:
    issue = client.get("/api/v1/issues/current").json()
    response = client.get(f"/api/v1/issues/{issue['id']}/rankings?category=python")
    assert response.status_code == 200
    assert response.json()["category"] == "python"


def test_manual_collection_requires_admin(anonymous_client, user_client, admin_client) -> None:
    assert anonymous_client.post("/api/v1/admin/collections").status_code == 401
    assert user_client.post("/api/v1/admin/collections").status_code == 403
    assert admin_client.post("/api/v1/admin/collections").status_code == 202
```

再覆盖：非法分类返回 422、运行中手动刷新返回 409、状态接口超过 90 分钟标记 delayed、搜索和筛选组合、游标分页。

- [ ] **Step 2：运行测试并确认失败**

Run: `cd research-reports; python -m pytest tests/test_api.py -q`

Expected: FAIL，提示应用工厂不存在。

- [ ] **Step 3：实现 `SiteAuthClient`**

客户端向 `{SITE_AUTH_URL}/internal/v1/session/verify` 转发：`sd_session`、`sd_csrf`、请求方法、Origin 和 `X-CSRF-Token`，并携带 `SITE_AUTH_INTERNAL_KEY`。返回不可变身份：

```python
@dataclass(frozen=True, slots=True)
class SiteIdentity:
    id: str
    username: str
    email: str
    role: str
    is_active: bool
```

认证依赖将上游 401 映射为 401，将已登录非管理员映射为 403，将认证服务不可用映射为 503。

- [ ] **Step 4：实现公开和管理员路由**

公开接口必须匹配设计规格。管理员 `POST /api/v1/admin/collections` 调用协调器非阻塞触发；触发成功返回：

```json
{"run_id":"<uuid>","status":"running"}
```

若锁已占用返回 409。所有接口返回 Pydantic schema，不直接序列化 ORM 对象的内部字段。

所有公开 JSON 字段通过统一的 Pydantic alias generator 输出 camelCase，例如 `previous_issue_rank` 输出为 `previousIssueRank`；请求筛选参数仍保持设计规格中的小写名称。

- [ ] **Step 5：实现应用生命周期**

`create_app(settings=None, collector=None, auth_client=None, start_scheduler=True)` 支持依赖注入。生命周期启动时建表、确保活跃期、启动调度器；关闭时停止调度器、关闭 HTTP 客户端并 dispose 数据库。

- [ ] **Step 6：运行全部后端测试并提交**

Run: `cd research-reports; python -m pytest tests -q`

Expected: 全部 PASS，0 failures。

```powershell
git add -- research-reports/research_reports research-reports/tests
git commit -m "feat(reports): expose public and admin APIs"
```

---

### Task 8：实现前端 API 客户端和展示转换

**Files:**
- Create: `SD/lib/researchReports.ts`
- Create: `SD/lib/researchReports.test.ts`
- Create: `SD/components/reports/reportViewModel.ts`
- Create: `SD/components/reports/reportViewModel.test.ts`

- [ ] **Step 1：先写 URL 和展示转换测试**

```typescript
it('encodes combined ranking filters', () => {
  expect(buildRankingUrl('issue-1', {
    category: 'typescript', query: 'agent kit', status: 'new', license: 'MIT',
  })).toBe('/issues/issue-1/rankings?category=typescript&query=agent+kit&status=new&license=MIT');
});

it('formats rank movement without relying on color', () => {
  expect(toRankSignal({ rank: 2, previousIssueRank: 5, status: 'rising' }))
    .toEqual({ label: '上升 3 位', icon: 'up', delta: 3 });
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `cd SD; npm test -- lib/researchReports.test.ts components/reports/reportViewModel.test.ts`

Expected: FAIL，提示目标模块不存在。

- [ ] **Step 3：实现类型和请求函数**

`researchReports.ts` 导出 `IssueSummary`、`RankingRepository`、`RankingResponse`、`CollectionStatus`、`CollectionRun`，以及：

```typescript
export const listIssues = (): Promise<IssueSummary[]> => reportRequest('/issues');
export const getCurrentIssue = (): Promise<IssueSummary> => reportRequest('/issues/current');
export const getRankings = (issueId: string, filters: RankingFilters) =>
  reportRequest<RankingResponse>(buildRankingUrl(issueId, filters));
export const startCollection = () =>
  reportRequest<CollectionRun>('/admin/collections', { method: 'POST' });
export const getCollectionRun = (runId: string) =>
  reportRequest<CollectionRun>(`/admin/collections/${encodeURIComponent(runId)}`);
```

写请求读取 `sd_csrf` Cookie，并对非 GET 请求设置 `X-CSRF-Token` 和 `credentials: 'include'`。401、403、409、503 映射为稳定的中文错误，不吞掉服务端可读 detail。

- [ ] **Step 4：实现展示纯函数并运行测试**

Run: `cd SD; npm test -- lib/researchReports.test.ts components/reports/reportViewModel.test.ts`

Expected: 全部 PASS。

```powershell
git add -- SD/lib/researchReports.ts SD/lib/researchReports.test.ts SD/components/reports/reportViewModel.ts SD/components/reports/reportViewModel.test.ts
git commit -m "feat(reports): add typed frontend API client"
```

---

### Task 9：实现研报入口和 GitHub 周榜页面

**Files:**
- Create: `SD/pages/ReportsPage.tsx`
- Create: `SD/pages/GitHubReportsPage.tsx`
- Create: `SD/components/reports/ReportHeader.tsx`
- Create: `SD/components/reports/ReportFilters.tsx`
- Create: `SD/components/reports/RankingList.tsx`
- Create: `SD/components/reports/AdminCollectionPanel.tsx`
- Create: `SD/components/reports/GitHubReportsPage.test.tsx`

- [ ] **Step 1：写页面源代码契约测试**

当前前端没有 jsdom 测试环境，因此先沿用项目的源代码契约测试：

```typescript
it('renders every approved category and real-data states', () => {
  const source = readFileSync(new URL('../../pages/GitHubReportsPage.tsx', import.meta.url), 'utf8');
  for (const label of ['综合榜', 'Python', 'JavaScript', 'TypeScript', 'Go', 'Rust']) {
    expect(source).toContain(label);
  }
  expect(source).toContain('数据延迟');
  expect(source).not.toContain('example/repository');
});
```

再检查 `RankingList` 包含安全外链属性、语义化列表和移动端断点，管理员面板检查 `currentUser?.role === 'admin'`。

- [ ] **Step 2：运行测试并确认失败**

Run: `cd SD; npm test -- components/reports/GitHubReportsPage.test.tsx`

Expected: FAIL，提示页面文件不存在。

- [ ] **Step 3：实现入口页和页面容器**

`ReportsPage` 展示 GitHub 周榜产品卡、当前期、最近更新和进入按钮。`GitHubReportsPage` 管理 `issueId`、`category`、筛选条件、加载/错误/延迟状态；筛选输入使用 250ms debounce，切换分类取消过期请求。

- [ ] **Step 4：实现榜单组件**

`ReportHeader` 展示 ISO 期号和下一次任务；`ReportFilters` 使用具有文字标签的 tab/button；`RankingList` 在 `md` 以下卡片化，并为状态提供图标和文字；外链固定：

```tsx
<a href={repository.htmlUrl} target="_blank" rel="noopener noreferrer">
  查看 GitHub
</a>
```

不得在前端伪造项目。服务没有数据时展示采集状态和管理员刷新入口。

- [ ] **Step 5：实现管理员刷新状态**

管理员点击后调用 `startCollection()`；拿到 202 后每 2 秒查询运行状态，完成或 60 秒后停止。409 显示“已有采集任务运行中”，不重复发起。

- [ ] **Step 6：运行页面测试和 TypeScript 检查并提交**

Run: `cd SD; npm test -- components/reports/GitHubReportsPage.test.tsx`

Expected: 全部 PASS。

Run: `cd SD; npm run lint`

Expected: exit 0。

```powershell
git add -- SD/pages/ReportsPage.tsx SD/pages/GitHubReportsPage.tsx SD/components/reports
git commit -m "feat(reports): build GitHub weekly report UI"
```

---

### Task 10：接入主站路由、首页和开发代理

**Files:**
- Modify: `SD/App.tsx`
- Modify: `SD/pages/HomePage.tsx`
- Modify: `SD/vite.config.ts`
- Modify: `SD/lib/integrationRoutes.test.ts`

- [ ] **Step 1：先扩展集成测试**

```typescript
it('registers the independent research report routes and proxy', () => {
  expect(source('../App.tsx')).toContain('path="/reports"');
  expect(source('../App.tsx')).toContain('path="/reports/github"');
  expect(source('../vite.config.ts')).toContain("'/reports-api':");
  expect(source('../pages/HomePage.tsx')).toContain('to="/reports"');
});
```

- [ ] **Step 2：运行测试并确认失败**

Run: `cd SD; npm test -- lib/integrationRoutes.test.ts`

Expected: FAIL，指出缺少研报路由。

- [ ] **Step 3：用精确补丁接入路由**

在 `App.tsx` 导入两个页面，并在 `AppLayout` 子路由中增加：

```tsx
<Route path="/reports" element={<ReportsPage />} />
<Route path="/reports/github" element={<GitHubReportsPage />} />
```

在 `HomePage.tsx` 增加独立研报卡片，链接 `/reports`，不把研报塞进通用 `TOOLS` 注册表。

在 `vite.config.ts` 增加：

```typescript
'/reports-api': {
  target: 'http://127.0.0.1:8009',
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/reports-api/, ''),
},
```

- [ ] **Step 4：验证并提交**

Run: `cd SD; npm test -- lib/integrationRoutes.test.ts`

Expected: PASS。

Run: `cd SD; npm run build`

Expected: exit 0，Vite build completed。

暂存前运行 `git diff -- SD/App.tsx SD/pages/HomePage.tsx SD/vite.config.ts`，确认没有删除用户现有代码。

```powershell
git add -- SD/App.tsx SD/pages/HomePage.tsx SD/vite.config.ts SD/lib/integrationRoutes.test.ts
git commit -m "feat(reports): link weekly reports into main site"
```

---

### Task 11：接入全站运行、配置和部署

**Files:**
- Modify: `scripts/start-local.ps1`
- Modify: `scripts/check-local.ps1`
- Modify: `.env.local.example`
- Modify: `.gitignore`
- Modify: `nginx.conf`
- Modify: `README.md`
- Create: `research-reports/README.md`

- [ ] **Step 1：为运行脚本写静态契约测试**

Create: `research-reports/tests/test_workspace_integration.py`

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_workspace_runs_and_proxies_research_reports() -> None:
    start = (ROOT / "scripts/start-local.ps1").read_text(encoding="utf-8")
    check = (ROOT / "scripts/check-local.ps1").read_text(encoding="utf-8")
    vite = (ROOT / "SD/vite.config.ts").read_text(encoding="utf-8")
    assert "Name='research-reports'" in start
    assert "Ports=@(8009)" in start
    assert "8000..8009" in check
    assert "'/reports-api'" in vite
```

- [ ] **Step 2：运行测试并确认失败**

Run: `cd research-reports; python -m pytest tests/test_workspace_integration.py -q`

Expected: FAIL，指出启动脚本未注册服务。

- [ ] **Step 3：接入启动和检查脚本**

在后端服务列表增加：

```powershell
[pscustomobject]@{
    Name='research-reports'
    WorkingDirectory='research-reports'
    Executable='python'
    Arguments=@('-m','uvicorn','research_reports.main:create_app','--factory','--host','127.0.0.1','--port','8009')
    Ports=@(8009)
}
```

`check-local.ps1` 将端口范围改为 `8000..8009`，并检查 `/health`、公开当前期接口、匿名管理员刷新 401；登录后检查管理员采集记录 200。冒烟测试不触发真实手动采集，避免每次检查访问 GitHub。

- [ ] **Step 4：补充安全配置和忽略规则**

`.env.local.example` 增加设计规格中的研报变量，`GITHUB_TOKEN=` 保持空。`.gitignore` 增加：

```gitignore
research-reports/data/
research-reports/cache/
```

- [ ] **Step 5：补充开发和生产代理**

`nginx.conf` 增加：

```nginx
location ^~ /reports-api/ {
    proxy_pass http://127.0.0.1:8009/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

- [ ] **Step 6：更新文档**

`research-reports/README.md` 说明模块目标、配置、测试、调度边界和可选 Token。根 README 只增加模块表格项、8009 端口和 `/reports` 地址，不重写其他章节。

- [ ] **Step 7：运行契约测试并提交**

Run: `cd research-reports; python -m pytest tests/test_workspace_integration.py -q`

Expected: PASS。

暂存前分别检查每个已存在文件的 diff，确保不包含与研报无关的工作区改动。

```powershell
git add -- scripts/start-local.ps1 scripts/check-local.ps1 .env.local.example .gitignore nginx.conf README.md research-reports/README.md research-reports/tests/test_workspace_integration.py
git commit -m "feat(reports): integrate service into local stack"
```

---

### Task 12：真实采集、全量验证和交付

**Files:**
- Modify only if a verification failure identifies a scoped defect.

- [ ] **Step 1：运行后端全量测试**

Run: `cd research-reports; python -m pytest tests -q`

Expected: 0 failures。

- [ ] **Step 2：运行前端全量测试和构建**

Run: `cd SD; npm test`

Expected: 0 failures。

Run: `cd SD; npm run build`

Expected: exit 0。

- [ ] **Step 3：验证敏感文件不会提交**

Run: `git check-ignore .env.local research-reports/data/reports.db research-reports/cache/sample`

Expected: 三个路径全部输出。

Run: `git diff --cached --name-only`

Expected: 空；没有意外暂存文件。

- [ ] **Step 4：重启完整本地服务**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-local.ps1`

Expected: 所有受管服务停止，没有 workspace 外路径错误。

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1`

Expected: 8000–8009 和三个前端端口启动。

- [ ] **Step 5：执行一次真实管理员刷新**

使用 `.env.local` 中的统一管理员凭据登录 site-auth，保留 WebRequestSession 和 CSRF Cookie，再向 `http://127.0.0.1:5173/reports-api/api/v1/admin/collections` 发起一次 POST。不得在命令输出打印密码、Cookie、内部密钥或 GitHub Token。

轮询运行状态直至 `success` 或 `partial`。随后验证六个分类均返回真实仓库 URL；若 GitHub 某分类短暂失败，确认页面/API 保留最近成功结果并显示 delayed，而不是写入示例数据。

- [ ] **Step 6：运行全站冒烟检查**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-local.ps1`

Expected: `All local smoke checks passed.`，并包含 8009、研报公开接口和管理员日志检查。

- [ ] **Step 7：检查工作区与提交历史**

Run: `git status --short`

Expected: 只剩实施前已经存在且与本模块无关的用户改动；研报文件均已提交。

Run: `git log --oneline -12`

Expected: 能看到本计划每个任务的独立提交，且没有包含数据库、日志、缓存或 `.env.local`。

---

## 最终验收清单

- [ ] `/reports` 与 `/reports/github` 可直接刷新访问。
- [ ] 综合、Python、JavaScript、TypeScript、Go、Rust 六榜均来自真实 GitHub 数据。
- [ ] 每小时整点任务和周一 08:30 换榜通过模拟时间测试。
- [ ] 新上榜、回归、升降、连续热门、增长最快计算正确。
- [ ] GitHub 单分类故障不清空旧榜，也不影响其他分类。
- [ ] 匿名用户可读；普通用户不能刷新；管理员使用统一账号刷新。
- [ ] 桌面和 360px 页面可阅读，键盘可操作，状态不只靠颜色区分。
- [ ] 8009 服务由统一脚本管理，停止它不影响其他模块。
- [ ] Token、Cookie、数据库、缓存、日志和 `.env.local` 未进入 Git。
