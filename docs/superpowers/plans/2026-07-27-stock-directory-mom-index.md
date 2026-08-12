# Complete Stock Directory and Mom Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-stock search stub with a persisted full Shanghai/Shenzhen main-board directory and turn the Mom Index placeholder into a real Eastmoney plus Xiaohongshu dashboard with scheduled and administrator-triggered refresh.

**Architecture:** FastAPI remains the only public stock API. Network and browser collection run behind focused adapters and background coordinators; SQLite repositories atomically retain the last valid stock directory and real Mom Index snapshots. Xiaohongshu runs through the Playwright `rednote-mcp` package over local stdio, with a stable `xhs_*` adapter, read-only tool allowlisting and a private persistent data directory.

**Tech Stack:** Python 3.11, FastAPI, SQLite, AKShare, pypinyin, APScheduler, Python MCP client, `rednote-mcp`, Playwright, React 19, TypeScript, Vitest.

---

### Task 1: Persist and search the complete stock directory

**Files:**
- Create: `stock-research-package/stock-module/backend/app/repositories/stock_directory.py`
- Modify: `stock-research-package/stock-module/backend/app/services/stock_directory.py`
- Modify: `stock-research-package/stock-module/backend/app/domain/stocks.py`
- Test: `stock-research-package/stock-module/backend/tests/test_stock_directory_repository.py`
- Test: `stock-research-package/stock-module/backend/tests/test_stocks.py`

- [ ] **Step 1: Write failing repository and search tests**

```python
def test_replace_is_atomic_and_searches_code_name_and_initials(tmp_path):
    repository = StockDirectoryRepository(tmp_path / "hub.db")
    repository.replace(
        [
            StockDirectoryEntry(symbol="600519", name="贵州茅台", exchange="SSE", initials="gzmt"),
            StockDirectoryEntry(symbol="000001", name="平安银行", exchange="SZSE", initials="payh"),
        ],
        source="akshare_code_name",
        generated_at=datetime(2026, 7, 27, tzinfo=timezone.utc),
    )
    directory = StockDirectory(repository)
    assert [item.symbol for item in directory.search("6005")] == ["600519"]
    assert [item.symbol for item in directory.search("茅台")] == ["600519"]
    assert [item.symbol for item in directory.search("gzmt")] == ["600519"]
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `python -m pytest tests/test_stock_directory_repository.py tests/test_stocks.py -q`

Expected: collection fails because `StockDirectoryRepository`, `StockDirectoryEntry`, and persisted `StockDirectory` do not exist.

- [ ] **Step 3: Implement the repository, metadata and persisted search service**

```python
class StockDirectoryRepository:
    def replace(self, entries, *, source: str, generated_at: datetime) -> None:
        if len(entries) < self.minimum_count:
            raise InvalidStockDirectory("股票目录数量异常")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM stock_directory")
            connection.executemany(
                "INSERT INTO stock_directory(symbol,name,exchange,initials) VALUES(?,?,?,?)",
                [(e.symbol, e.name, e.exchange, e.initials) for e in entries],
            )
            connection.execute(
                "INSERT OR REPLACE INTO stock_directory_meta(id,source,generated_at) VALUES(1,?,?)",
                (source, generated_at.isoformat()),
            )

class StockDirectory:
    def search(self, query: str, limit: int = 20) -> list[StockSearchResult]:
        return self.repository.search(query.strip().lower(), limit)
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `python -m pytest tests/test_stock_directory_repository.py tests/test_stocks.py -q`

Expected: all focused tests pass.

- [ ] **Step 5: Commit the stock directory persistence**

```powershell
git add stock-research-package/stock-module/backend/app/repositories/stock_directory.py stock-research-package/stock-module/backend/app/services/stock_directory.py stock-research-package/stock-module/backend/app/domain/stocks.py stock-research-package/stock-module/backend/tests/test_stock_directory_repository.py stock-research-package/stock-module/backend/tests/test_stocks.py
git commit -m "feat(stock): persist complete searchable directory"
```

### Task 2: Refresh the directory safely from AKShare

**Files:**
- Create: `stock-research-package/stock-module/backend/app/integrations/stock_directory_sources.py`
- Create: `stock-research-package/stock-module/backend/app/services/stock_directory_refresh.py`
- Modify: `stock-research-package/stock-module/backend/app/config.py`
- Modify: `stock-research-package/stock-module/backend/pyproject.toml`
- Test: `stock-research-package/stock-module/backend/tests/test_stock_directory_sources.py`
- Test: `stock-research-package/stock-module/backend/tests/test_stock_directory_refresh.py`

- [ ] **Step 1: Write failing source, filtering, fallback and preservation tests**

```python
def test_source_filters_non_main_st_st_and_delisted_rows():
    rows = [
        {"code": "600519", "name": "贵州茅台"},
        {"code": "688001", "name": "华兴源创"},
        {"code": "300750", "name": "宁德时代"},
        {"code": "000001", "name": "ST平安"},
        {"code": "600001", "name": "退市测试"},
    ]
    assert [item.symbol for item in normalize_directory_rows(rows)] == ["600519"]

def test_failed_refresh_preserves_last_valid_snapshot(existing_repository, failing_source):
    service = StockDirectoryRefreshService(existing_repository, failing_source, minimum_count=1)
    with pytest.raises(StockDirectoryRefreshFailed):
        service.refresh()
    assert existing_repository.search("600519", 20)[0].name == "贵州茅台"
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `python -m pytest tests/test_stock_directory_sources.py tests/test_stock_directory_refresh.py -q`

Expected: imports fail because the source and refresh service are absent.

- [ ] **Step 3: Implement AKShare primary/fallback loading and validated replacement**

```python
class AkshareStockDirectorySource:
    def load(self) -> StockDirectoryBatch:
        try:
            frame = self.akshare.stock_info_a_code_name()
            return StockDirectoryBatch("akshare_code_name", normalize_frame(frame))
        except Exception as primary_error:
            try:
                frames = [self.akshare.stock_sh_a_spot_em(), self.akshare.stock_sz_a_spot_em()]
                return StockDirectoryBatch("eastmoney_spot_fallback", normalize_frames(frames))
            except Exception as fallback_error:
                raise StockDirectorySourceUnavailable(str(fallback_error)) from primary_error

class StockDirectoryRefreshService:
    def refresh(self) -> StockDirectoryMetadata:
        batch = self.source.load()
        entries = validate_directory(batch.entries, minimum_count=self.minimum_count)
        self.repository.replace(entries, source=batch.source, generated_at=self.clock())
        return self.repository.metadata()
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `python -m pytest tests/test_stock_directory_sources.py tests/test_stock_directory_refresh.py -q`

Expected: all focused tests pass.

- [ ] **Step 5: Commit directory refresh**

```powershell
git add stock-research-package/stock-module/backend/app/integrations/stock_directory_sources.py stock-research-package/stock-module/backend/app/services/stock_directory_refresh.py stock-research-package/stock-module/backend/app/config.py stock-research-package/stock-module/backend/pyproject.toml stock-research-package/stock-module/backend/tests/test_stock_directory_sources.py stock-research-package/stock-module/backend/tests/test_stock_directory_refresh.py
git commit -m "feat(stock): refresh full main-board directory"
```

### Task 3: Model and persist real Mom Index snapshots

**Files:**
- Create: `stock-research-package/stock-module/backend/app/domain/mom_index.py`
- Create: `stock-research-package/stock-module/backend/app/repositories/mom_index.py`
- Test: `stock-research-package/stock-module/backend/tests/test_mom_index_repository.py`

- [ ] **Step 1: Write failing snapshot and history tests**

```python
def test_repository_returns_latest_real_snapshot_and_history(tmp_path):
    repository = MomIndexRepository(tmp_path / "hub.db")
    repository.save(snapshot("2026-07-26", index=35.0))
    repository.save(snapshot("2026-07-27", index=62.0))
    assert repository.current().snapshot_date.isoformat() == "2026-07-27"
    assert [item.snapshot_date.isoformat() for item in repository.history(2)] == [
        "2026-07-27",
        "2026-07-26",
    ]

def test_snapshot_rejects_simulated_sources():
    with pytest.raises(ValidationError):
        snapshot("2026-07-27", source_kind="simulated")
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `python -m pytest tests/test_mom_index_repository.py -q`

Expected: import fails because the Mom Index domain and repository are absent.

- [ ] **Step 3: Implement typed snapshots and SQLite history**

```python
class MomSourceStatus(BaseModel):
    source_id: Literal["eastmoney", "xiaohongshu"]
    status: Literal["ok", "error", "login_required", "risk_controlled"]
    collected_at: datetime
    post_count: int = Field(ge=0)
    message: str | None = None

class MomIndexSnapshot(BaseModel):
    snapshot_date: date
    generated_at: datetime
    completeness: Literal["complete", "partial"]
    sectors: dict[Literal["nasdaq", "gold", "cpo", "semiconductor"], MomSectorIndex]
    sources: list[MomSourceStatus]

class MomIndexRepository:
    def save(self, snapshot: MomIndexSnapshot) -> None:
        self.connection.execute(
            "INSERT OR REPLACE INTO mom_index_snapshots(snapshot_date,payload,generated_at) VALUES(?,?,?)",
            (snapshot.snapshot_date.isoformat(), snapshot.model_dump_json(), snapshot.generated_at.isoformat()),
        )
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `python -m pytest tests/test_mom_index_repository.py -q`

Expected: all focused tests pass.

- [ ] **Step 5: Commit Mom Index persistence**

```powershell
git add stock-research-package/stock-module/backend/app/domain/mom_index.py stock-research-package/stock-module/backend/app/repositories/mom_index.py stock-research-package/stock-module/backend/tests/test_mom_index_repository.py
git commit -m "feat(stock): persist real mom index snapshots"
```

### Task 4: Adapt Eastmoney and pinned Playwright Xiaohongshu data

**Files:**
- Create: `stock-research-package/stock-module/backend/app/integrations/mom_sources.py`
- Create: `stock-research-package/stock-module/backend/app/integrations/xhs_mcp.py`
- Create: `stock-research-package/stock-module/backend/app/services/mom_index.py`
- Create: `stock-research-package/stock-module/backend/tests/fixtures/xhs-search.json`
- Test: `stock-research-package/stock-module/backend/tests/test_mom_sources.py`
- Test: `stock-research-package/stock-module/backend/tests/test_mom_index_service.py`
- Modify: `stock-research-package/stock-module/backend/pyproject.toml`

- [ ] **Step 1: Write failing adapter and partial-success tests**

```python
def test_xhs_adapter_deduplicates_notes_and_never_returns_simulated_data():
    client = FakeMcpClient(search_results=load_fixture("xhs-search.json"))
    result = XiaohongshuMomSource(client).collect(KEYWORDS)
    assert result.status.status == "ok"
    assert len({post.platform_id for post in result.posts}) == len(result.posts)
    assert all(post.platform == "xiaohongshu" for post in result.posts)

def test_service_saves_partial_snapshot_when_only_eastmoney_succeeds(repository):
    service = MomIndexService(repository, eastmoney=successful_source(), xhs=login_required_source())
    snapshot = service.refresh()
    assert snapshot.completeness == "partial"
    assert {source.status for source in snapshot.sources} == {"ok", "login_required"}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `python -m pytest tests/test_mom_sources.py tests/test_mom_index_service.py -q`

Expected: imports fail because the source adapters and service are absent.

- [ ] **Step 3: Implement read-only MCP allowlisting and source aggregation**

```python
ALLOWED_XHS_TOOLS = {
    "xhs_check_auth_status",
    "xhs_add_account",
    "xhs_check_login_session",
    "xhs_search",
    "xhs_get_note",
}

class XhsMcpClient:
    async def call(self, tool: str, arguments: dict) -> dict:
        if tool not in ALLOWED_XHS_TOOLS:
            raise PermissionError(f"XHS tool is not allowed: {tool}")
        parameters = StdioServerParameters(
            command=self.command[0],
            args=self.command[1:],
            env={**self.environment, "XHS_MCP_DATA_DIR": str(self.data_dir)},
        )
        async with stdio_client(parameters) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()
                return parse_mcp_result(await session.call_tool(tool, arguments))

class MomIndexService:
    def refresh(self) -> MomIndexSnapshot:
        results = [self.eastmoney.collect(), self.xhs.collect()]
        successful = [result for result in results if result.status.status == "ok"]
        if not successful:
            raise MomIndexUnavailable("两个真实来源均采集失败")
        snapshot = calculate_snapshot(successful, statuses=[result.status for result in results])
        self.repository.save(snapshot)
        return snapshot
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `python -m pytest tests/test_mom_sources.py tests/test_mom_index_service.py -q`

Expected: all focused tests pass.

- [ ] **Step 5: Commit real source adapters**

```powershell
git add stock-research-package/stock-module/backend/app/integrations/mom_sources.py stock-research-package/stock-module/backend/app/integrations/xhs_mcp.py stock-research-package/stock-module/backend/app/services/mom_index.py stock-research-package/stock-module/backend/tests/fixtures/xhs-search.json stock-research-package/stock-module/backend/tests/test_mom_sources.py stock-research-package/stock-module/backend/tests/test_mom_index_service.py stock-research-package/stock-module/backend/pyproject.toml
git commit -m "feat(stock): collect real mom index sources"
```

### Task 5: Add leases, scheduling, APIs and login flow

**Files:**
- Create: `stock-research-package/stock-module/backend/app/repositories/job_leases.py`
- Create: `stock-research-package/stock-module/backend/app/services/scheduled_jobs.py`
- Modify: `stock-research-package/stock-module/backend/app/main.py`
- Modify: `stock-research-package/stock-module/backend/app/config.py`
- Test: `stock-research-package/stock-module/backend/tests/test_scheduled_jobs.py`
- Test: `stock-research-package/stock-module/backend/tests/test_mom_index_api.py`
- Test: `stock-research-package/stock-module/backend/tests/test_stock_directory_api.py`

- [ ] **Step 1: Write failing lease, schedule, API and permission tests**

```python
def test_daily_jobs_use_shanghai_schedule_and_database_lease():
    scheduler = build_scheduler(timezone_name="Asia/Shanghai")
    assert scheduler.get_job("mom-index-refresh").trigger.hour == 8
    assert scheduler.get_job("mom-index-refresh").trigger.minute == 30

def test_public_reads_and_admin_controls(client, admin_cookies):
    assert client.get("/api/v1/mom-index/current").status_code == 200
    assert client.post("/api/v1/mom-index/refresh").status_code == 401
    assert client.post("/api/v1/mom-index/refresh", cookies=admin_cookies).status_code == 202
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `python -m pytest tests/test_scheduled_jobs.py tests/test_mom_index_api.py tests/test_stock_directory_api.py -q`

Expected: endpoints, scheduler and lease repository are missing.

- [ ] **Step 3: Implement leases, background task state, public reads and admin controls**

```python
@application.get("/api/v1/mom-index/current", response_model=MomIndexSnapshot)
def current_mom_index() -> MomIndexSnapshot:
    snapshot = mom_indexes.current()
    if snapshot is None:
        raise HTTPException(status_code=404, detail={"code": "MOM_INDEX_NOT_FOUND"})
    return snapshot

@application.post("/api/v1/mom-index/refresh", status_code=202)
def refresh_mom_index(_: SiteIdentity = Depends(current_admin)) -> dict:
    return mom_refresh.start().model_dump(mode="json")

@application.post("/api/v1/mom-index/xhs/login")
async def start_xhs_login(_: SiteIdentity = Depends(current_admin)) -> dict:
    return await xhs_login.start()
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `python -m pytest tests/test_scheduled_jobs.py tests/test_mom_index_api.py tests/test_stock_directory_api.py -q`

Expected: all focused tests pass.

- [ ] **Step 5: Commit APIs and scheduling**

```powershell
git add stock-research-package/stock-module/backend/app/repositories/job_leases.py stock-research-package/stock-module/backend/app/services/scheduled_jobs.py stock-research-package/stock-module/backend/app/main.py stock-research-package/stock-module/backend/app/config.py stock-research-package/stock-module/backend/tests/test_scheduled_jobs.py stock-research-package/stock-module/backend/tests/test_mom_index_api.py stock-research-package/stock-module/backend/tests/test_stock_directory_api.py
git commit -m "feat(stock): schedule and expose mom index refresh"
```

### Task 6: Build the Mom Index dashboard and administrator controls

**Files:**
- Modify: `stock-research-package/stock-module/frontend/src/types.ts`
- Modify: `stock-research-package/stock-module/frontend/src/api.ts`
- Modify: `stock-research-package/stock-module/frontend/src/App.tsx`
- Modify: `stock-research-package/stock-module/frontend/src/components/MomIndexPanel.tsx`
- Modify: `stock-research-package/stock-module/frontend/src/index.css`
- Create: `stock-research-package/stock-module/frontend/src/components/MomIndexPanel.test.tsx`
- Modify: `stock-research-package/stock-module/frontend/src/api.test.ts`

- [ ] **Step 1: Write failing panel and API tests**

```tsx
it("renders four sectors, source status and stale warning", () => {
  render(<MomIndexPanel snapshot={snapshotFixture} history={historyFixture} />);
  expect(screen.getByText("纳斯达克")).toBeInTheDocument();
  expect(screen.getByText("黄金")).toBeInTheDocument();
  expect(screen.getByText("CPO 通信")).toBeInTheDocument();
  expect(screen.getByText("半导体")).toBeInTheDocument();
  expect(screen.getByText("小红书需要重新登录")).toBeInTheDocument();
});

it("redirects anonymous administrator refresh to login", async () => {
  mockFetchStatus(401);
  await expect(refreshMomIndex()).rejects.toThrow();
  expect(window.location.assign).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd test -- src/components/MomIndexPanel.test.tsx src/api.test.ts`

Expected: the panel props, types and API functions are absent.

- [ ] **Step 3: Implement typed loading, cards, SVG trends, source badges and QR controls**

```tsx
export function MomIndexPanel({ snapshot, history, admin }: Props) {
  if (!snapshot) return <section className="panel mom-index-panel"><p>暂无真实宝妈指数</p></section>;
  return (
    <section className="panel mom-index-panel">
      <header>
        <div><span className="section-kicker">反向情绪观察</span><h2>宝妈指数</h2></div>
        {admin && <button onClick={admin.onRefresh}>立即刷新</button>}
      </header>
      <div className="mom-sector-grid">
        {SECTOR_ORDER.map((key) => (
          <MomSectorCard key={key} sector={snapshot.sectors[key]} points={history.map(item => item.sectors[key].index)} />
        ))}
      </div>
      <MomSourceStatuses sources={snapshot.sources} onLogin={admin?.onLogin} />
    </section>
  );
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm.cmd test -- src/components/MomIndexPanel.test.tsx src/api.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit dashboard**

```powershell
git add stock-research-package/stock-module/frontend/src/types.ts stock-research-package/stock-module/frontend/src/api.ts stock-research-package/stock-module/frontend/src/App.tsx stock-research-package/stock-module/frontend/src/components/MomIndexPanel.tsx stock-research-package/stock-module/frontend/src/components/MomIndexPanel.test.tsx stock-research-package/stock-module/frontend/src/index.css stock-research-package/stock-module/frontend/src/api.test.ts
git commit -m "feat(stock): display real mom index dashboard"
```

### Task 7: Deployment, licensing and complete verification

**Files:**
- Modify: `.env.local.example`
- Modify: `.env.production.example`
- Modify: `.gitignore`
- Modify: `stock-research-package/UPSTREAMS.md`
- Modify: `stock-research-package/stock-module/README.md`
- Modify: `scripts/start-local.ps1`
- Modify: `scripts/check-local.ps1`
- Modify: `deploy/baota/README.md`

- [ ] **Step 1: Add pinned configuration and private data exclusions**

```dotenv
STOCK_XHS_DATA_DIR=../data/xhs-mcp
STOCK_XHS_MCP_COMMAND=npx.cmd -y rednote-mcp@0.2.3 --stdio
STOCK_MARKET_PROXY=
STOCK_MOM_REFRESH_TIME=08:30
STOCK_TIMEZONE=Asia/Shanghai
```

Add `stock-research-package/stock-module/data/xhs-mcp/` to the root ignore rules and record the MIT dependency and exact `2.7.0` version in `UPSTREAMS.md`.

- [ ] **Step 2: Document first login and read-only smoke verification**

```powershell
cd E:\AI\gp\stock-research-package\stock-module\backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8002
# Sign in as an administrator, open /stock/, choose 小红书登录, scan the QR,
# then trigger one manual Mom Index refresh and confirm both source timestamps.
```

- [ ] **Step 3: Run all backend and adapter tests**

Run: `python -m pytest -q` from `stock-research-package/stock-module/backend`

Expected: all tests pass with zero failures.

Run: `python -m pytest -q` from `stock-research-package/stock-module/analysis-service`

Expected: all tests pass with zero failures.

- [ ] **Step 4: Run all frontend tests and production build**

Run: `npm.cmd test -- --run`

Expected: all Vitest files and tests pass.

Run: `npm.cmd run build`

Expected: TypeScript checking and Vite production build succeed.

- [ ] **Step 5: Run repository integration checks**

Run: `powershell -ExecutionPolicy Bypass -File scripts/check-local.ps1`

Expected: public stock reads succeed, anonymous control endpoints return 401, and authenticated administrator checks succeed when the local stack is running.

- [ ] **Step 6: Inspect final diff and commit documentation**

```powershell
git diff --check
git status --short
git add .env.local.example .env.production.example .gitignore stock-research-package/UPSTREAMS.md stock-research-package/stock-module/README.md scripts/start-local.ps1 scripts/check-local.ps1 deploy/baota/README.md
git commit -m "docs(stock): document directory and mom index operations"
```
