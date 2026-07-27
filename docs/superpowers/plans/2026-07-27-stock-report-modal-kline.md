# Stock Research Modal and K-line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stock research side drawer with a centered wide modal and display cached, real Eastmoney daily K-line data for 20, 60, or 120 trading days.

**Architecture:** Add a backend market-data slice containing public Pydantic models, an AKShare/Eastmoney adapter, a SQLite cache repository, and an orchestration service exposed through one read-only endpoint. On the frontend, keep research-context and K-line loading independent, render OHLCV/MA data with dependency-free SVG components, and preserve the existing analysis flow and dialog accessibility.

**Tech Stack:** Python 3.11, FastAPI, Pydantic 2, SQLite, AKShare, pytest, React 19, TypeScript 5.9, SVG, Vitest, Testing Library.

---

## File Structure

Backend:

- Create `stock-research-package/stock-module/backend/app/domain/market_data.py`: stable K-line public models and domain exceptions.
- Create `stock-research-package/stock-module/backend/app/integrations/market_data.py`: AKShare/Eastmoney history adapter and Chinese-column normalization.
- Create `stock-research-package/stock-module/backend/app/repositories/kline_cache.py`: SQLite persistence for the latest 120-bar normalized payload per symbol.
- Create `stock-research-package/stock-module/backend/app/services/kline.py`: period validation, TTL/stale policy, moving averages, cache selection, and source fallback.
- Create `stock-research-package/stock-module/backend/tests/test_market_data_integration.py`: adapter normalization tests.
- Create `stock-research-package/stock-module/backend/tests/test_kline_repository.py`: SQLite round-trip tests.
- Create `stock-research-package/stock-module/backend/tests/test_kline_service.py`: calculation, cache, stale fallback, and unavailable-data tests.
- Create `stock-research-package/stock-module/backend/tests/test_kline_api.py`: FastAPI contract and validation tests.
- Modify `stock-research-package/stock-module/backend/app/main.py`: construct/inject the K-line service and publish the endpoint.

Frontend:

- Modify `stock-research-package/stock-module/frontend/src/types.ts`: add `KlineBar`, `KlineLatest`, and `StockKline`.
- Modify `stock-research-package/stock-module/frontend/src/api.ts`: add `loadStockKline`.
- Modify `stock-research-package/stock-module/frontend/src/api.test.ts`: assert endpoint and period query generation.
- Create `stock-research-package/stock-module/frontend/src/components/StockQuoteSummary.tsx`: current price and session summary.
- Create `stock-research-package/stock-module/frontend/src/components/StockKlineChart.tsx`: responsive SVG candles, moving averages, volume, and focusable data points.
- Create `stock-research-package/stock-module/frontend/src/components/StockKlineChart.test.tsx`: chart semantics and period interaction tests.
- Create `stock-research-package/stock-module/frontend/src/components/StockEvidenceGrid.tsx`: existing structured research evidence.
- Create `stock-research-package/stock-module/frontend/src/components/StockResearchModal.tsx`: dialog behavior and independent request states.
- Create `stock-research-package/stock-module/frontend/src/components/StockResearchModal.test.tsx`: modal loading, degradation, focus, and close tests.
- Delete `stock-research-package/stock-module/frontend/src/components/StockDetailDrawer.tsx`: superseded implementation.
- Modify `stock-research-package/stock-module/frontend/src/App.tsx`: render `StockResearchModal`.
- Modify `stock-research-package/stock-module/frontend/src/App.test.tsx`: mock K-line calls and preserve end-to-end analysis assertions.
- Modify `stock-research-package/stock-module/frontend/src/index.css`: centered 1280px modal, two-column evidence layout, chart styling, and mobile layout.

### Task 1: Define and normalize real K-line data

**Files:**

- Create: `stock-research-package/stock-module/backend/app/domain/market_data.py`
- Create: `stock-research-package/stock-module/backend/app/integrations/market_data.py`
- Create: `stock-research-package/stock-module/backend/tests/test_market_data_integration.py`

- [ ] **Step 1: Write failing adapter tests**

Create tests using a tiny frame-compatible fake so they do not contact Eastmoney:

```python
def test_akshare_source_normalizes_qfq_daily_bars() -> None:
    frame = FakeFrame([
        {"日期": "2026-07-24", "开盘": 10, "最高": 11, "最低": 9.8, "收盘": 10.5, "成交量": 1000, "涨跌幅": 2.0},
        {"日期": "2026-07-25", "开盘": 10.5, "最高": 11.2, "最低": 10.2, "收盘": 11, "成交量": 1200, "涨跌幅": 4.76},
    ])
    akshare = FakeAkshare(frame)

    result = AkshareKlineSource(akshare).load("600519", minimum_bars=2)

    assert akshare.kwargs["adjust"] == "qfq"
    assert result[0].date.isoformat() == "2026-07-24"
    assert result[1].close == 11
    assert result[1].volume == 1200
```

Also cover empty frames, invalid numeric cells, ascending date order, duplicate-date removal, and an AKShare failure followed by a successful direct Eastmoney response. The direct-response fixture must use Eastmoney's `data.klines` string order `date,open,close,high,low,volume,amount,amplitude,change_pct,change,turnover`.

- [ ] **Step 2: Run the adapter test and verify failure**

Run:

```powershell
cd stock-research-package/stock-module/backend
python -m pytest tests/test_market_data_integration.py -q
```

Expected: collection fails because `app.domain.market_data` and `app.integrations.market_data` do not exist.

- [ ] **Step 3: Add the public domain models**

Define the exact contract:

```python
class RawKlineBar(BaseModel):
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: float
    change_pct: float | None = None

class KlineBar(RawKlineBar):
    ma5: float | None = None
    ma10: float | None = None
    ma20: float | None = None

class KlineLatest(BaseModel):
    trade_date: date
    price: float
    change: float
    change_pct: float
    high: float
    low: float
    volume: float

class StockKline(BaseModel):
    symbol: str
    name: str
    exchange: Literal["SSE", "SZSE"]
    period: Literal["daily"] = "daily"
    adjustment: Literal["qfq"] = "qfq"
    days: Literal[20, 60, 120]
    source: Literal["eastmoney"] = "eastmoney"
    generated_at: datetime
    stale: bool = False
    latest: KlineLatest
    bars: list[KlineBar]

class KlineUnavailable(RuntimeError):
    pass
```

- [ ] **Step 4: Implement the AKShare adapter**

`EastmoneyKlineSource.load(symbol, minimum_bars)` must first call `stock_zh_a_hist` with:

```python
{
    "symbol": symbol,
    "period": "daily",
    "start_date": (today - timedelta(days=420)).strftime("%Y%m%d"),
    "end_date": today.strftime("%Y%m%d"),
    "adjust": "qfq",
}
```

Normalize `日期/开盘/最高/最低/收盘/成交量/涨跌幅`, reject non-finite OHLCV values, sort by date, and retain one bar per date. Construct AKShare lazily inside a default factory so importing the web app remains testable.

If AKShare fails or returns no usable bars, request `https://push2his.eastmoney.com/api/qt/stock/kline/get` with `secid=1.<symbol>` for SSE or `0.<symbol>` for SZSE, `klt=101`, `fqt=1`, `beg=0`, `end=20500101`, `lmt=max(160, minimum_bars)`, `fields1=f1,f2,f3,f4,f5,f6`, and `fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`. Parse the documented comma-separated `data.klines` rows through the same normalization path. If both attempts fail, raise `KlineUnavailable` with no raw upstream body in its message.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
python -m pytest tests/test_market_data_integration.py -q
```

Expected: all adapter tests pass.

Commit:

```powershell
git add backend/app/domain/market_data.py backend/app/integrations/market_data.py backend/tests/test_market_data_integration.py
git commit -m "feat(stock): normalize real daily kline data"
```

### Task 2: Persist and serve cached K-line data

**Files:**

- Create: `stock-research-package/stock-module/backend/app/repositories/kline_cache.py`
- Create: `stock-research-package/stock-module/backend/app/services/kline.py`
- Create: `stock-research-package/stock-module/backend/tests/test_kline_repository.py`
- Create: `stock-research-package/stock-module/backend/tests/test_kline_service.py`

- [ ] **Step 1: Write failing repository and service tests**

Repository coverage:

```python
repository.save("600519", bars, fetched_at)
cached = repository.get("600519")
assert cached is not None
assert cached.fetched_at == fetched_at
assert cached.bars[-1].close == bars[-1].close
```

Service coverage must use an injected clock and source:

```python
result = service.get("600519", days=20)
assert len(result.bars) == 20
assert result.bars[-1].ma5 == pytest.approx(sum(closes[-5:]) / 5)
assert result.latest.change == pytest.approx(closes[-1] - closes[-2])
assert result.stale is False
```

Add tests for 5-minute trading TTL, 30-minute off-hours TTL, stale cache fallback up to 14 days, refusal beyond 14 days, source failure without cache, and 20/60/120 validation.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
python -m pytest tests/test_kline_repository.py tests/test_kline_service.py -q
```

Expected: collection fails because the repository and service modules do not exist.

- [ ] **Step 3: Implement SQLite cache**

Create table:

```sql
CREATE TABLE IF NOT EXISTS stock_kline_cache (
    symbol TEXT PRIMARY KEY,
    bars_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
)
```

Expose `save(symbol, bars, fetched_at)` and `get(symbol) -> CachedKline | None`. Serialize bars with Pydantic JSON mode and parse timestamps as timezone-aware values.

- [ ] **Step 4: Implement K-line orchestration**

`KlineService.get(symbol, days)` must:

1. Normalize the symbol with `normalize_symbol`.
2. Accept only `20`, `60`, or `120`.
3. Return a fresh cached series without contacting the source.
4. Otherwise request at least 140 source bars so MA20 is available before slicing; the source internally tries AKShare/Eastmoney first and direct Eastmoney second.
5. Save the normalized source payload before producing the selected response.
6. On source failure, return cache only when fetched no more than 14 calendar days ago and mark it stale.
7. Raise `KlineUnavailable` when no acceptable real payload exists.
8. Compute MA5/10/20 from unsliced closes, then return only the requested tail.
9. Resolve `name` from the existing stock directory where available, falling back to the symbol.
10. Use `Asia/Shanghai`; apply a 5-minute TTL on weekdays from 09:15–15:15 and 30 minutes otherwise.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
python -m pytest tests/test_kline_repository.py tests/test_kline_service.py -q
```

Expected: all cache and service tests pass.

Commit:

```powershell
git add backend/app/repositories/kline_cache.py backend/app/services/kline.py backend/tests/test_kline_repository.py backend/tests/test_kline_service.py
git commit -m "feat(stock): cache and calculate daily kline"
```

### Task 3: Publish the K-line HTTP endpoint

**Files:**

- Modify: `stock-research-package/stock-module/backend/app/main.py`
- Create: `stock-research-package/stock-module/backend/tests/test_kline_api.py`

- [ ] **Step 1: Write failing API tests**

Inject a fake service into `create_app(kline_service=...)` and test:

```python
response = await client.get("/api/v1/stocks/600519/kline", params={"days": 60})
assert response.status_code == 200
assert response.json()["adjustment"] == "qfq"
assert response.json()["days"] == 60
assert response.json()["bars"][-1]["date"] == "2026-07-27"
```

Also assert `days=30` returns `422`, a ChiNext symbol returns `422/MAIN_BOARD_ONLY`, and `KlineUnavailable` returns `503/KLINE_UNAVAILABLE`.

- [ ] **Step 2: Run the API test and verify failure**

Run:

```powershell
python -m pytest tests/test_kline_api.py -q
```

Expected: `create_app` rejects `kline_service` or the endpoint returns 404.

- [ ] **Step 3: Wire the service and route**

Add an optional `kline_service` constructor dependency for tests; otherwise construct `KlineRepository(database_path)`, `EastmoneyKlineSource(proxy=configured.market_proxy)`, and `KlineService(..., directory=directory)`. Add:

```python
@application.get(
    "/api/v1/stocks/{symbol}/kline",
    response_model=StockKline,
)
def stock_kline(
    symbol: str,
    days: Literal[20, 60, 120] = Query(default=60),
) -> StockKline:
    try:
        return klines.get(symbol, days=days)
    except InvalidMainBoardSymbol as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "MAIN_BOARD_ONLY", "message": str(exc)},
        ) from exc
    except KlineUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": "KLINE_UNAVAILABLE", "message": "当前真实行情暂不可用"},
        ) from exc
```

- [ ] **Step 4: Run backend regression tests and commit**

Run:

```powershell
python -m pytest -q
```

Expected: the full backend suite passes.

Commit:

```powershell
git add backend/app/main.py backend/tests/test_kline_api.py
git commit -m "feat(stock): expose daily kline endpoint"
```

### Task 4: Add the typed frontend K-line client

**Files:**

- Modify: `stock-research-package/stock-module/frontend/src/types.ts`
- Modify: `stock-research-package/stock-module/frontend/src/api.ts`
- Modify: `stock-research-package/stock-module/frontend/src/api.test.ts`

- [ ] **Step 1: Write the failing client test**

```typescript
await loadStockKline("600519", 120);
expect(fetch).toHaveBeenCalledWith(
  "/stock-api/api/v1/stocks/600519/kline?days=120",
  expect.objectContaining({ credentials: "include" }),
);
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```powershell
cd stock-research-package/stock-module/frontend
npm test -- --run src/api.test.ts
```

Expected: failure because `loadStockKline` is not exported.

- [ ] **Step 3: Add exact TypeScript models and request**

Add:

```typescript
export type KlineDays = 20 | 60 | 120;
export type KlineBar = {
  date: string; open: number; high: number; low: number; close: number;
  volume: number; change_pct: number | null;
  ma5: number | null; ma10: number | null; ma20: number | null;
};
export type StockKline = {
  symbol: string; name: string; exchange: "SSE" | "SZSE";
  period: "daily"; adjustment: "qfq"; days: KlineDays;
  source: "eastmoney"; generated_at: string; stale: boolean;
  latest: {
    trade_date: string; price: number; change: number; change_pct: number;
    high: number; low: number; volume: number;
  };
  bars: KlineBar[];
};
```

Implement `loadStockKline(symbol, days = 60)` using the existing `request` helper.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
npm test -- --run src/api.test.ts
```

Expected: API tests pass.

Commit:

```powershell
git add frontend/src/types.ts frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat(stock): add typed kline client"
```

### Task 5: Build the accessible SVG K-line chart

**Files:**

- Create: `stock-research-package/stock-module/frontend/src/components/StockQuoteSummary.tsx`
- Create: `stock-research-package/stock-module/frontend/src/components/StockKlineChart.tsx`
- Create: `stock-research-package/stock-module/frontend/src/components/StockKlineChart.test.tsx`
- Modify: `stock-research-package/stock-module/frontend/src/index.css`

- [ ] **Step 1: Write failing chart component tests**

Render a deterministic 20-bar fixture and assert:

```typescript
expect(screen.getByRole("img", { name: "600519 最近20个交易日日K线" })).toBeInTheDocument();
expect(screen.getAllByTestId("kline-candle")).toHaveLength(20);
expect(screen.getByText("MA5")).toBeInTheDocument();
expect(screen.getByText("MA10")).toBeInTheDocument();
expect(screen.getByText("MA20")).toBeInTheDocument();
fireEvent.focus(screen.getAllByTestId("kline-point")[19]);
expect(screen.getByText("2026-07-27")).toBeInTheDocument();
```

Also assert the quote summary shows price, signed percentage, high, low, volume, time, and “最近缓存” when `stale=true`.

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- --run src/components/StockKlineChart.test.tsx
```

Expected: component imports fail.

- [ ] **Step 3: Implement quote formatting and SVG geometry**

Use one `viewBox="0 0 1000 440"` SVG. Reserve y=20–300 for price, y=330–420 for volume, derive shared x positions from the bar index, and guard zero ranges with a minimum denominator. Render:

- wick `<line>` and body `<rect data-testid="kline-candle">`;
- red `#c4473d` for `close >= open`, green `#2f7a56` otherwise;
- MA5/10/20 `<polyline>` segments that skip null values;
- transparent focusable `<rect data-testid="kline-point" tabIndex={0}>` per bar;
- a live detail strip showing date, OHLC, change percentage, and volume for the focused/hovered bar;
- an SVG title/ARIA label and a text fallback when bars are empty.

- [ ] **Step 4: Add chart and summary styles**

Add scoped `.kline-*` and `.quote-*` rules with a 16:7 desktop aspect, minimum 320px chart height, visible keyboard focus, tabular numerals, and horizontal overflow protection below 720px.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
npm test -- --run src/components/StockKlineChart.test.tsx
npm run build
```

Expected: chart tests pass and TypeScript/Vite build succeeds.

Commit:

```powershell
git add frontend/src/components/StockQuoteSummary.tsx frontend/src/components/StockKlineChart.tsx frontend/src/components/StockKlineChart.test.tsx frontend/src/index.css
git commit -m "feat(stock): render accessible svg kline chart"
```

### Task 6: Replace the drawer with the wide research modal

**Files:**

- Create: `stock-research-package/stock-module/frontend/src/components/StockEvidenceGrid.tsx`
- Create: `stock-research-package/stock-module/frontend/src/components/StockResearchModal.tsx`
- Create: `stock-research-package/stock-module/frontend/src/components/StockResearchModal.test.tsx`
- Delete: `stock-research-package/stock-module/frontend/src/components/StockDetailDrawer.tsx`
- Modify: `stock-research-package/stock-module/frontend/src/App.tsx`
- Modify: `stock-research-package/stock-module/frontend/src/App.test.tsx`
- Modify: `stock-research-package/stock-module/frontend/src/index.css`

- [ ] **Step 1: Write failing modal tests**

Mock both API calls and verify:

```typescript
expect(await screen.findByRole("dialog", { name: "股票研究详情" })).toHaveClass("stock-research-modal");
expect(loadStockKline).toHaveBeenCalledWith("000400", 60);
fireEvent.click(screen.getByRole("button", { name: "近120日" }));
expect(loadStockKline).toHaveBeenCalledWith("000400", 120);
```

Add cases proving research evidence renders while K-line is pending or failed, the prior chart remains during a failed period switch, context failure does not hide a successful chart, backdrop/Escape close the dialog, and trigger focus is restored.

- [ ] **Step 2: Run modal tests and verify failure**

Run:

```powershell
npm test -- --run src/components/StockResearchModal.test.tsx src/App.test.tsx
```

Expected: the modal component does not exist and App still renders the drawer.

- [ ] **Step 3: Extract the evidence component**

Move `dimensionNames`, `EvidenceList`, source cards, score breakdown, catalysts, risks, invalid conditions, related news, and the no-source message into `StockEvidenceGrid`. Keep its input to `context: StockResearchContext` so it has no loading or API concerns.

- [ ] **Step 4: Implement independent modal request state**

`StockResearchModal` must:

- request context and 60-day K-line in parallel whenever `symbol` changes;
- track `contextError` separately from `klineError`;
- retain the last successful K-line while switching periods;
- ignore settled promises after unmount/symbol change using effect cleanup flags;
- use three `aria-pressed` buttons for 20/60/120;
- preserve body scroll locking, Escape close, backdrop close, close-button autofocus, and focus restoration;
- render the chart before evidence and keep the existing `AnalysisControls` at the bottom.

- [ ] **Step 5: Replace drawer layout and App usage**

Change `App.tsx` import/render from `StockDetailDrawer` to `StockResearchModal`. Replace CSS behavior with:

```css
.research-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(28, 39, 34, .36);
}
.stock-research-modal {
  width: min(1280px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 16px;
  background: var(--paper);
  box-shadow: 0 24px 70px rgba(31, 44, 37, .24);
}
```

Use a sticky heading and a two-column evidence area above 900px; switch to a single column and near-full-screen dimensions below 720px. Remove obsolete `.drawer-backdrop` and `.stock-drawer` rules.

- [ ] **Step 6: Update App mocks and assertions**

Add `loadStockKline` to the hoisted mock map and provide a 60-bar default fixture in `beforeEach`. Rename drawer-oriented test names to modal-oriented names while retaining all existing structured-evidence and analysis-flow expectations.

- [ ] **Step 7: Run frontend tests and commit**

Run:

```powershell
npm test
npm run build
```

Expected: the full frontend suite and production build pass.

Commit:

```powershell
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/components/StockEvidenceGrid.tsx frontend/src/components/StockResearchModal.tsx frontend/src/components/StockResearchModal.test.tsx frontend/src/index.css
git rm frontend/src/components/StockDetailDrawer.tsx
git commit -m "feat(stock): replace detail drawer with research modal"
```

### Task 7: Verify real data and the unified local route

**Files:**

- Modify only if verification exposes a defect in files already listed above.

- [ ] **Step 1: Run complete automated verification**

Run:

```powershell
cd stock-research-package/stock-module/backend
python -m pytest -q
cd ../frontend
npm test
npm run build
```

Expected: all backend tests, all frontend tests, TypeScript checking, and Vite production build pass.

- [ ] **Step 2: Restart the isolated backend and frontend**

Use the repository’s existing local start flow, keeping backend on `127.0.0.1:8002`, stock Vite on `127.0.0.1:5175`, and unified access through `http://127.0.0.1:5173/stock/`.

- [ ] **Step 3: Verify the real endpoint**

Request:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8002/api/v1/stocks/600519/kline?days=60'
```

Expected: `source=eastmoney`, `adjustment=qfq`, 60 chronological bars, finite OHLCV values, and a latest trade date matching the newest available market session.

- [ ] **Step 4: Verify the UI manually**

At `http://127.0.0.1:5173/stock/`, sign in and confirm:

1. A candidate and direct code `600519` both open a centered wide modal.
2. The 20/60/120 controls redraw the chart.
3. Price summary, candles, MA5/10/20, and volume are visible.
4. K-line failure messaging does not hide research evidence or analysis controls.
5. Escape, backdrop click, close button, scrolling, focus restoration, and narrow viewport layout work.

- [ ] **Step 5: Record final status**

Run:

```powershell
git status --short
git log --oneline -7
```

Expected: no uncommitted feature changes; the design, plan, backend, and frontend commits are visible.
