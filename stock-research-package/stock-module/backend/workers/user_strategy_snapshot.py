"""Generate the normalized K-line snapshot consumed by the user strategy engine."""

import argparse
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
import json
import math
import os
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.domain.stocks import InvalidMainBoardSymbol, normalize_symbol
from app.domain.strategies import SMALL_CAP_MARKET_CAP_LIMIT
from workers.ths_hot_concepts import StockSeedData, collect_ths_hot_stock_pool


DEFAULT_TOP_CONCEPTS = 30


@dataclass(frozen=True)
class StockSeed:
    symbol: str
    name: str
    concepts: list[str]
    market_cap: float | None = None


HistoryLoader = Callable[[str], Any]


def normalize_history(frame: Any) -> list[dict[str, float | str]]:
    rows = frame.to_dict(orient="records")
    output: list[dict[str, float | str]] = []
    previous_close: float | None = None
    for row in rows:
        close = _number(row.get("收盘", row.get("close")))
        open_price = _number(row.get("开盘", row.get("open")))
        high = _number(row.get("最高", row.get("high")))
        low = _number(row.get("最低", row.get("low")))
        volume = _number(row.get("成交量", row.get("volume")))
        if None in {open_price, high, low, close, volume}:
            continue
        trade_date = _date_string(row.get("日期", row.get("date", row.get("trade_date"))))
        pct = _number(row.get("涨跌幅", row.get("pct")))
        if pct is None:
            pct = ((close / previous_close) - 1) * 100 if previous_close else 0.0
        normalized = {
            "open": float(open_price),
            "high": float(high),
            "low": float(low),
            "close": float(close),
            "pct": round(float(pct), 4),
            "volume": float(volume),
        }
        if trade_date is not None:
            normalized["date"] = trade_date
        output.append(normalized)
        previous_close = close
    return output


def build_snapshot(
    stock_pool: dict[str, StockSeed],
    history_loader: HistoryLoader,
    generated_at: datetime,
    *,
    min_bars: int = 150,
    small_cap_pool: dict[str, StockSeed] | None = None,
) -> dict[str, object]:
    return {
        "generated_at": generated_at.isoformat(),
        "stocks": _build_snapshot_rows(stock_pool, history_loader, min_bars=min_bars),
        "small_cap_stocks": _build_snapshot_rows(
            small_cap_pool or {},
            history_loader,
            min_bars=min_bars,
        ),
    }


def _build_snapshot_rows(
    stock_pool: dict[str, StockSeed],
    history_loader: HistoryLoader,
    *,
    min_bars: int,
) -> list[dict[str, object]]:
    stocks: list[dict[str, object]] = []
    for raw_symbol, seed in stock_pool.items():
        try:
            symbol = normalize_symbol(raw_symbol)
        except InvalidMainBoardSymbol:
            continue
        if "ST" in seed.name.upper() or "退" in seed.name:
            continue
        try:
            bars = normalize_history(history_loader(symbol))
        except Exception:
            continue
        if len(bars) < min_bars:
            continue
        record: dict[str, object] = {
            "symbol": symbol,
            "name": seed.name,
            "concepts": list(dict.fromkeys(seed.concepts)),
            "bars": bars,
        }
        if seed.market_cap is not None:
            record["market_cap"] = seed.market_cap
        stocks.append(record)
    return stocks


def write_snapshot_atomic(payload: dict[str, object], output_path: Path) -> None:
    sections = (payload.get("stocks"), payload.get("small_cap_stocks"))
    if not any(isinstance(section, list) and section for section in sections):
        raise ValueError("拒绝用空快照覆盖最近成功结果")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, output_path)
    finally:
        if temporary.exists():
            temporary.unlink()


def collect_hot_stock_pool(
    akshare: Any,
    *,
    top_concepts: int,
    max_stocks: int,
    concept_cache: Path | None = None,
    ths_collector: Callable[..., dict[str, StockSeedData]] = collect_ths_hot_stock_pool,
) -> dict[str, StockSeed]:
    try:
        ths_pool = ths_collector(
            akshare,
            top_concepts=top_concepts,
            max_stocks=max_stocks,
            cache_path=concept_cache,
        )
    except Exception:
        ths_pool = {}
    if ths_pool:
        return {
            symbol: StockSeed(
                symbol=seed.symbol,
                name=seed.name,
                concepts=list(seed.concepts[:3]),
            )
            for symbol, seed in ths_pool.items()
        }
    return _collect_eastmoney_concept_pool(
        akshare,
        top_concepts=top_concepts,
        max_stocks=max_stocks,
    )


def collect_small_cap_stock_pool(
    akshare: Any,
    *,
    market_cap_limit: float = SMALL_CAP_MARKET_CAP_LIMIT,
) -> dict[str, StockSeed]:
    """Collect every eligible main-board stock with a trustworthy market cap."""
    frame = akshare.stock_zh_a_spot_em()
    if frame is None or frame.empty:
        raise RuntimeError("东方财富全市场行情为空，无法筛选小市值股票")

    pool: dict[str, StockSeed] = {}
    for row in frame.to_dict(orient="records"):
        raw_symbol = str(_first_value(row, "代码", "code", "symbol") or "").strip()
        if raw_symbol.isdigit():
            raw_symbol = raw_symbol.zfill(6)
        try:
            symbol = normalize_symbol(raw_symbol)
        except InvalidMainBoardSymbol:
            continue
        name = str(_first_value(row, "名称", "name") or symbol).strip()
        if "ST" in name.upper() or "退" in name:
            continue
        market_cap = _number(
            _first_value(row, "总市值", "总市值(元)", "market_cap", "total_market_cap")
        )
        if market_cap is None or not math.isfinite(market_cap) or market_cap >= market_cap_limit:
            continue
        pool[symbol] = StockSeed(
            symbol=symbol,
            name=name,
            concepts=[],
            market_cap=market_cap,
        )
    return pool


def _collect_eastmoney_concept_pool(
    akshare: Any,
    *,
    top_concepts: int,
    max_stocks: int,
) -> dict[str, StockSeed]:
    try:
        board_frame = akshare.stock_board_concept_name_em()
    except Exception:
        return _collect_market_fallback(akshare, max_stocks=max_stocks)
    if board_frame is None or board_frame.empty:
        return _collect_market_fallback(akshare, max_stocks=max_stocks)
    ranked = board_frame.sort_values(by=["涨跌幅", "换手率"], ascending=[False, False]).head(top_concepts)
    pool: dict[str, StockSeed] = {}
    for concept in ranked["板块名称"].astype(str).tolist():
        try:
            members = akshare.stock_board_concept_cons_em(symbol=concept)
        except Exception:
            continue
        if members is None or members.empty:
            continue
        for row in members.to_dict(orient="records"):
            symbol = str(row.get("代码", "")).zfill(6)
            name = str(row.get("名称", symbol))
            if symbol in pool:
                pool[symbol].concepts.append(concept)
            else:
                pool[symbol] = StockSeed(symbol=symbol, name=name, concepts=[concept])
            if len(pool) >= max_stocks:
                return pool
    return pool or _collect_market_fallback(akshare, max_stocks=max_stocks)


def _collect_market_fallback(akshare: Any, *, max_stocks: int) -> dict[str, StockSeed]:
    """Use Sina's full-market quote table when Eastmoney concept APIs are unavailable."""
    try:
        frame = akshare.stock_zh_a_spot()
    except Exception as exc:
        raise RuntimeError("热门概念和全市场备用数据均不可用") from exc
    if frame is None or frame.empty:
        raise RuntimeError("热门概念和全市场备用数据均为空")

    ranked: list[tuple[float, float, str, str]] = []
    for row in frame.to_dict(orient="records"):
        raw_symbol = str(row.get("代码", row.get("code", ""))).strip()
        symbol = raw_symbol[-6:]
        try:
            symbol = normalize_symbol(symbol)
        except InvalidMainBoardSymbol:
            continue
        name = str(row.get("名称", row.get("name", symbol))).strip()
        if "ST" in name.upper() or "退" in name:
            continue
        pct = _number(row.get("涨跌幅", row.get("changepercent"))) or 0.0
        volume = _number(row.get("成交量", row.get("volume"))) or 0.0
        ranked.append((pct, volume, symbol, name))

    ranked.sort(key=lambda item: (-item[0], -item[1], item[2]))
    pool = {
        symbol: StockSeed(symbol=symbol, name=name, concepts=[])
        for _, _, symbol, name in ranked[:max_stocks]
    }
    return _attach_sina_industries(akshare, pool)


def _attach_sina_industries(
    akshare: Any,
    pool: dict[str, StockSeed],
) -> dict[str, StockSeed]:
    unresolved = set(pool)
    try:
        sectors = akshare.stock_sector_spot(indicator="新浪行业")
        sector_rows = sectors.to_dict(orient="records")
    except Exception:
        sector_rows = []

    for sector in sector_rows:
        label = str(sector.get("label", "")).strip()
        name = str(sector.get("板块", "")).strip()
        if not label or not name:
            continue
        try:
            members = akshare.stock_sector_detail(sector=label)
        except Exception:
            continue
        for row in members.to_dict(orient="records"):
            symbol = str(row.get("code", row.get("代码", ""))).strip()[-6:]
            if symbol in unresolved:
                pool[symbol].concepts.append(name)
                unresolved.remove(symbol)
        if not unresolved:
            break

    for symbol in unresolved:
        pool[symbol].concepts.append("题材暂不可用")
    return pool


def load_history_with_fallback(
    akshare: Any,
    symbol: str,
    start_date: str,
    end_date: str,
) -> Any:
    try:
        frame = akshare.stock_zh_a_hist(
            symbol=symbol,
            period="daily",
            start_date=start_date,
            adjust="qfq",
        )
        if frame is not None and not frame.empty:
            return frame
    except Exception:
        pass
    exchange_symbol = f"{'sh' if symbol.startswith('6') else 'sz'}{symbol}"
    return akshare.stock_zh_a_daily(
        symbol=exchange_symbol,
        start_date=start_date,
        end_date=end_date,
        adjust="qfq",
    )


def _first_value(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip() != "":
            return value
    return None


def _date_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    for pattern in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"):
        try:
            return datetime.strptime(text[:10] if pattern != "%Y%m%d" else text, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成 Star Dominion 用户策略 K 线快照")
    parser.add_argument("--output", required=True, help="latest.json 输出路径")
    parser.add_argument("--top-concepts", type=int, default=DEFAULT_TOP_CONCEPTS)
    parser.add_argument("--max-stocks", type=int, default=120)
    parser.add_argument("--lookback-days", type=int, default=420)
    parser.add_argument("--concept-cache", help="同花顺概念交易日缓存路径")
    args = parser.parse_args(argv)
    if args.lookback_days < 180:
        parser.error("--lookback-days 不能少于 180")

    # The original strategy scripts deliberately bypass system proxies because
    # Eastmoney commonly closes proxied connections while the direct route works.
    for variable in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        os.environ.pop(variable, None)

    try:
        import akshare as ak
    except ImportError as exc:
        raise SystemExit('缺少 Worker 依赖，请安装 pip install -e ".[workers]"') from exc

    output_path = Path(args.output)
    concept_cache = (
        Path(args.concept_cache)
        if args.concept_cache
        else output_path.parent / "ths-concepts-cache.json"
    )
    pool = collect_hot_stock_pool(
        ak,
        top_concepts=args.top_concepts,
        max_stocks=args.max_stocks,
        concept_cache=concept_cache,
    )
    start_date = (datetime.now() - timedelta(days=args.lookback_days)).strftime("%Y%m%d")
    end_date = datetime.now().strftime("%Y%m%d")

    def load_history(symbol: str) -> Any:
        return load_history_with_fallback(ak, symbol, start_date, end_date)

    generated_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    try:
        small_cap_pool = collect_small_cap_stock_pool(ak)
        payload = build_snapshot(
            pool,
            load_history,
            generated_at,
            small_cap_pool=small_cap_pool,
        )
        payload.update(
            {
                "small_cap_status": "ok",
                "small_cap_generated_at": generated_at.isoformat(),
            }
        )
    except Exception as exc:
        previous = _read_existing_snapshot(output_path)
        payload = build_snapshot(pool, load_history, generated_at)
        previous_small_cap = previous.get("small_cap_stocks")
        if isinstance(previous_small_cap, list):
            payload["small_cap_stocks"] = previous_small_cap
        payload.update(
            {
                "small_cap_status": "error",
                "small_cap_error": str(exc),
                "small_cap_generated_at": previous.get("small_cap_generated_at"),
            }
        )
    write_snapshot_atomic(payload, output_path)
    print(
        f"已生成用户策略快照：{output_path.resolve()}（"
        f"原策略 {len(payload['stocks'])} 只，小市值 {len(payload['small_cap_stocks'])} 只）"
    )
    return 0


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").replace("%", ""))
    except (TypeError, ValueError):
        return None


def _read_existing_snapshot(output_path: Path) -> dict[str, Any]:
    if not output_path.is_file():
        return {}
    try:
        payload = json.loads(output_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


if __name__ == "__main__":
    raise SystemExit(main())
