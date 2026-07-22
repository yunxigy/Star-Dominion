"""Generate the normalized K-line snapshot consumed by the user strategy engine."""

import argparse
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.domain.stocks import InvalidMainBoardSymbol, normalize_symbol


@dataclass(frozen=True)
class StockSeed:
    symbol: str
    name: str
    concepts: list[str]


HistoryLoader = Callable[[str], Any]


def normalize_history(frame: Any) -> list[dict[str, float]]:
    rows = frame.to_dict(orient="records")
    output: list[dict[str, float]] = []
    previous_close: float | None = None
    for row in rows:
        close = _number(row.get("收盘", row.get("close")))
        open_price = _number(row.get("开盘", row.get("open")))
        high = _number(row.get("最高", row.get("high")))
        low = _number(row.get("最低", row.get("low")))
        volume = _number(row.get("成交量", row.get("volume")))
        if None in {open_price, high, low, close, volume}:
            continue
        pct = _number(row.get("涨跌幅", row.get("pct")))
        if pct is None:
            pct = ((close / previous_close) - 1) * 100 if previous_close else 0.0
        output.append(
            {
                "open": float(open_price),
                "high": float(high),
                "low": float(low),
                "close": float(close),
                "pct": round(float(pct), 4),
                "volume": float(volume),
            }
        )
        previous_close = close
    return output


def build_snapshot(
    stock_pool: dict[str, StockSeed],
    history_loader: HistoryLoader,
    generated_at: datetime,
    *,
    min_bars: int = 150,
) -> dict[str, object]:
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
        stocks.append(
            {
                "symbol": symbol,
                "name": seed.name,
                "concepts": list(dict.fromkeys(seed.concepts)),
                "bars": bars,
            }
        )
    return {"generated_at": generated_at.isoformat(), "stocks": stocks}


def write_snapshot_atomic(payload: dict[str, object], output_path: Path) -> None:
    if not payload.get("stocks"):
        raise ValueError("拒绝用空快照覆盖最近成功结果")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, output_path)
    finally:
        if temporary.exists():
            temporary.unlink()


def collect_hot_stock_pool(akshare: Any, *, top_concepts: int, max_stocks: int) -> dict[str, StockSeed]:
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
    return {
        symbol: StockSeed(symbol=symbol, name=name, concepts=["全市场强势"])
        for _, _, symbol, name in ranked[:max_stocks]
    }


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="生成 Star Dominion 用户策略 K 线快照")
    parser.add_argument("--output", required=True, help="latest.json 输出路径")
    parser.add_argument("--top-concepts", type=int, default=10)
    parser.add_argument("--max-stocks", type=int, default=120)
    parser.add_argument("--lookback-days", type=int, default=420)
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

    pool = collect_hot_stock_pool(ak, top_concepts=args.top_concepts, max_stocks=args.max_stocks)
    start_date = (datetime.now() - timedelta(days=args.lookback_days)).strftime("%Y%m%d")
    end_date = datetime.now().strftime("%Y%m%d")

    def load_history(symbol: str) -> Any:
        return load_history_with_fallback(ak, symbol, start_date, end_date)

    payload = build_snapshot(pool, load_history, datetime.now(ZoneInfo("Asia/Shanghai")))
    write_snapshot_atomic(payload, Path(args.output))
    print(f"已生成用户策略快照：{Path(args.output).resolve()}（{len(payload['stocks'])} 只股票）")
    return 0


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").replace("%", ""))
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    raise SystemExit(main())
