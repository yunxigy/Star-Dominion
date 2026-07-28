# 同花顺热门题材排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用同花顺概念和当日板块热度生成选股题材，每只股票最多保留 3 个热门概念，并保留东方财富与新浪降级链。

**Architecture:** 新建独立的 `ths_hot_concepts` 适配器，负责同花顺公开页面请求、HTML 解析、交易日缓存和题材排序。`user_strategy_snapshot` 只编排“同花顺 → 东方财富 → 新浪行业”的数据源顺序，快照和前端数据结构保持不变。

**Tech Stack:** Python 3.11、requests、pandas、BeautifulSoup、pytest、AKShare。

---

## 文件结构

- Create: `stock-research-package/stock-module/backend/workers/ths_hot_concepts.py`
  - 同花顺 HTML 解析、概念快照模型、热度计算、缓存和候选池构建。
- Create: `stock-research-package/stock-module/backend/tests/test_ths_hot_concepts.py`
  - 使用固定 HTML 样本验证解析、排序、最多 3 个题材和缓存。
- Modify: `stock-research-package/stock-module/backend/workers/user_strategy_snapshot.py`
  - 将同花顺设为主来源并保留现有降级链。
- Modify: `stock-research-package/stock-module/backend/tests/test_user_strategy_worker.py`
  - 验证数据源优先级、部分失败和整体失败。

### Task 1: 同花顺页面解析与概念模型

**Files:**
- Create: `stock-research-package/stock-module/backend/workers/ths_hot_concepts.py`
- Create: `stock-research-package/stock-module/backend/tests/test_ths_hot_concepts.py`

- [ ] **Step 1: 写概念资金榜和板块详情的失败测试**

测试构造包含以下字段的 HTML：

```python
FUND_FLOW_HTML = """
<span class="page_info">1/1</span>
<table>
  <thead><tr>
    <th>序号</th><th>行业</th><th>行业指数</th><th>涨跌幅</th>
    <th>流入资金(亿)</th><th>流出资金(亿)</th><th>净额(亿)</th>
    <th>公司家数</th><th>领涨股</th><th>涨跌幅</th><th>当前价(元)</th>
  </tr></thead>
  <tbody>
    <tr><td>1</td><td>机器人</td><td>1000</td><td>4.20%</td>
      <td>20</td><td>12</td><td>8</td><td>80</td><td>甲公司</td><td>10%</td><td>12</td></tr>
  </tbody>
</table>
"""

DETAIL_HTML = """
<div class="board-infos">
  <dt>板块涨幅</dt><dd>4.20%</dd>
  <dt>涨跌家数</dt><dd>60 20</dd>
  <dt>成交额(亿)</dt><dd>500</dd>
</div>
<table>
  <thead><tr><th>序号</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌幅(%)</th></tr></thead>
  <tbody><tr><td>1</td><td>600001</td><td>甲公司</td><td>12</td><td>9.80</td></tr></tbody>
</table>
"""
```

断言 `parse_fund_flow_page()` 返回“机器人”的涨幅和公司数，`parse_concept_detail()` 返回板块涨幅、上涨/下跌家数、成交额与成员个股涨幅。

- [ ] **Step 2: 运行解析测试并确认 RED**

Run:

```powershell
python -m pytest tests/test_ths_hot_concepts.py -q
```

Expected: FAIL，原因是 `workers.ths_hot_concepts` 尚不存在。

- [ ] **Step 3: 实现最小解析器和不可变模型**

新增：

```python
@dataclass(frozen=True)
class ConceptMember:
    symbol: str
    name: str
    pct: float

@dataclass(frozen=True)
class ConceptSnapshot:
    name: str
    code: str
    pct: float
    turnover_yi: float
    up_count: int
    down_count: int
    members: tuple[ConceptMember, ...]
```

`parse_fund_flow_page(html)` 使用 `pandas.read_html(StringIO(html))`，兼容同花顺重复的“涨跌幅”列名；`parse_concept_detail(name, code, html)` 使用 BeautifulSoup 解析 `.board-infos`，再用 pandas 解析成员表。股票代码统一截取并补齐为 6 位。

- [ ] **Step 4: 运行解析测试并确认 GREEN**

Run:

```powershell
python -m pytest tests/test_ths_hot_concepts.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交解析器**

```powershell
git add stock-research-package/stock-module/backend/workers/ths_hot_concepts.py stock-research-package/stock-module/backend/tests/test_ths_hot_concepts.py
git commit -m "feat(stock): parse ths concept pages"
```

### Task 2: 热度与个股跟涨排序

**Files:**
- Modify: `stock-research-package/stock-module/backend/workers/ths_hot_concepts.py`
- Modify: `stock-research-package/stock-module/backend/tests/test_ths_hot_concepts.py`

- [ ] **Step 1: 写排序失败测试**

构造同一股票同时属于“机器人”“人工智能”“低价股”三个以上概念，断言：

```python
assert rank_stock_concepts("600001", snapshots, limit=3) == [
    "机器人",
    "人工智能",
    "低价股",
]
```

另加两个断言：返回数量不超过 3；分数相同时按概念名稳定排序。

- [ ] **Step 2: 运行排序测试并确认 RED**

Run:

```powershell
python -m pytest tests/test_ths_hot_concepts.py -q
```

Expected: FAIL，原因是 `rank_stock_concepts` 尚不存在。

- [ ] **Step 3: 实现归一化热度公式**

实现：

```python
board_strength = clamp((concept.pct + 5.0) / 10.0)
breadth = clamp(((concept.up_count - concept.down_count) /
                 max(concept.up_count + concept.down_count, 1) + 1.0) / 2.0)
activity = clamp(math.log1p(max(concept.turnover_yi, 0.0)) / math.log1p(2000.0))
sync = clamp(1.0 - abs(member.pct - concept.pct) / 20.0)
score = board_strength * 0.55 + breadth * 0.25 + activity * 0.10 + sync * 0.10
```

按 `(-score, concept.name)` 排序并截取 `limit=3`。

- [ ] **Step 4: 运行排序测试并确认 GREEN**

Run:

```powershell
python -m pytest tests/test_ths_hot_concepts.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交热度排序**

```powershell
git add stock-research-package/stock-module/backend/workers/ths_hot_concepts.py stock-research-package/stock-module/backend/tests/test_ths_hot_concepts.py
git commit -m "feat(stock): rank concepts by market heat"
```

### Task 3: 同花顺请求、缓存与候选池

**Files:**
- Modify: `stock-research-package/stock-module/backend/workers/ths_hot_concepts.py`
- Modify: `stock-research-package/stock-module/backend/tests/test_ths_hot_concepts.py`

- [ ] **Step 1: 写请求与缓存失败测试**

注入假的 `http_get` 和假的 AKShare：

```python
class FakeAkshare:
    def stock_board_concept_name_ths(self):
        return DataFrame([{"name": "机器人", "code": "301024"}])
```

断言：

- 资金榜请求使用 `X-Requested-With: XMLHttpRequest` 和同花顺 Referer。
- 只请求 `top_concepts` 个详情页。
- 一个详情页失败时其他概念仍被保留。
- 第二次使用同一交易日缓存时不发 HTTP 请求。
- 缓存日期变化时重新请求。

- [ ] **Step 2: 运行请求与缓存测试并确认 RED**

Run:

```powershell
python -m pytest tests/test_ths_hot_concepts.py -q
```

Expected: FAIL，原因是 `collect_ths_hot_stock_pool` 尚不存在。

- [ ] **Step 3: 实现同花顺采集与 JSON 缓存**

实现：

```python
def collect_ths_hot_stock_pool(
    akshare: Any,
    *,
    top_concepts: int,
    max_stocks: int,
    cache_path: Path | None,
    http_get: Callable[..., Response] = requests.get,
    today: date | None = None,
) -> dict[str, StockSeedData]:
```

请求顺序：

1. `http://data.10jqka.com.cn/funds/gnzjl/field/tradezdf/order/desc/page/1/ajax/1/free/1/`
2. `akshare.stock_board_concept_name_ths()` 建立名称到代码映射。
3. 对热度榜前 `top_concepts` 个名称请求 `https://q.10jqka.com.cn/gn/detail/code/{code}/`。

缓存写入 `{date, concepts}`，采用 `.tmp` + `os.replace` 原子替换。候选股票按“最佳概念分数、个股涨幅、股票代码”排序取前 `max_stocks`，每只股票的 `concepts` 调用 `rank_stock_concepts(..., limit=3)`。

- [ ] **Step 4: 运行适配器测试并确认 GREEN**

Run:

```powershell
python -m pytest tests/test_ths_hot_concepts.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交采集与缓存**

```powershell
git add stock-research-package/stock-module/backend/workers/ths_hot_concepts.py stock-research-package/stock-module/backend/tests/test_ths_hot_concepts.py
git commit -m "feat(stock): cache ths hot concepts"
```

### Task 4: 接入 worker 与完整降级链

**Files:**
- Modify: `stock-research-package/stock-module/backend/workers/user_strategy_snapshot.py`
- Modify: `stock-research-package/stock-module/backend/tests/test_user_strategy_worker.py`

- [ ] **Step 1: 写数据源优先级失败测试**

将现有东方财富逻辑抽为 `_collect_eastmoney_concept_pool()`。测试断言：

- 同花顺返回非空池时不调用东方财富。
- 同花顺抛错或返回空池时调用东方财富。
- 东方财富也失败时调用现有 `_collect_market_fallback()`。
- 同花顺返回的题材顺序和最多 3 个限制原样写入快照。

- [ ] **Step 2: 运行 worker 测试并确认 RED**

Run:

```powershell
python -m pytest tests/test_user_strategy_worker.py -q
```

Expected: FAIL，因为当前入口仍首先调用东方财富。

- [ ] **Step 3: 实现编排和默认缓存路径**

`collect_hot_stock_pool()` 调用顺序改为：

```python
try:
    pool = collect_ths_hot_stock_pool(...)
    if pool:
        return convert_ths_pool(pool)
except Exception:
    pass

pool = _collect_eastmoney_concept_pool(...)
return pool or _collect_market_fallback(...)
```

命令行新增可选 `--concept-cache`；未传入时使用输出文件同目录的 `ths-concepts-cache.json`。

- [ ] **Step 4: 运行 worker 与全量后端测试**

Run:

```powershell
python -m pytest tests/test_user_strategy_worker.py tests/test_ths_hot_concepts.py -q
python -m pytest -q
```

Expected: 目标测试和全量测试全部 PASS。

- [ ] **Step 5: 提交 worker 接入**

```powershell
git add stock-research-package/stock-module/backend/workers/user_strategy_snapshot.py stock-research-package/stock-module/backend/tests/test_user_strategy_worker.py
git commit -m "feat(stock): prefer ths hot concepts"
```

### Task 5: 刷新真实数据与页面验收

**Files:**
- Modify at runtime: `stock-research-package/stock-module/data/user-strategy/latest.json`
- Modify at runtime: `stock-research-package/stock-module/data/user-strategy/ths-concepts-cache.json`
- Modify at runtime: `stock-research-package/stock-module/data/hub.db`

- [ ] **Step 1: 运行真实 worker**

Run:

```powershell
python -m workers.user_strategy_snapshot --output ..\data\user-strategy\latest.json
```

Expected: 输出非空快照，日志显示同花顺概念数量和候选股票数量。

- [ ] **Step 2: 重建候选仓库**

使用 `UserStrategySnapshotSource(...).load()` 读取新快照，再调用 `CandidateSnapshotRepository(...).save(batch)` 写入 `data/hub.db`。

- [ ] **Step 3: 校验实际题材分布**

调用 `http://127.0.0.1:8002/api/v1/candidates`，断言：

```python
assert "全市场强势" not in themes
assert max(theme_count_per_stock) <= 3
assert len(set(themes)) > 3
```

打印数据源命中量、题材种类和前 10 个主线题材。

- [ ] **Step 4: 浏览器验收**

打开 `http://127.0.0.1:5173/stock/`，检查至少 5 只强势股：

- 显示 1 至 3 个题材。
- 第一题材来自当前同花顺热门概念。
- 不再全部显示同一行业。

- [ ] **Step 5: 最终验证**

Run:

```powershell
python -m pytest -q
git status --short
```

Expected: 全量测试通过；工作区只包含预期的运行时数据变更或保持干净。
