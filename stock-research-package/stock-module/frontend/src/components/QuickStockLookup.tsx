import { useState } from "react";

const MAIN_BOARD = /^(600|601|603|605|000|001|002)\d{3}$/;

export function QuickStockLookup({ onOpenDetail }: { onOpenDetail: (symbol: string, trigger?: HTMLElement) => void }) {
  const [symbol, setSymbol] = useState("");
  const normalized = symbol.trim();
  const valid = MAIN_BOARD.test(normalized);

  return (
    <section className="quick-lookup" aria-label="直接查询主板股票">
      <div>
        <span className="section-kicker">任意个股</span>
        <strong>直接查看结构化依据，再决定是否调用大模型</strong>
      </div>
      <div className="lookup-controls">
        <label className="sr-only" htmlFor="quick-stock-code">直接输入股票代码</label>
        <input
          id="quick-stock-code"
          value={symbol}
          onChange={(event) => setSymbol(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="输入 6 位 A 股主板代码"
          inputMode="numeric"
        />
        <button type="button" disabled={!valid} onClick={(event) => onOpenDetail(normalized, event.currentTarget)}>查看股票详情</button>
      </div>
      {normalized && !valid && <small>仅支持 600 / 601 / 603 / 605 / 000 / 001 / 002 开头的主板股票</small>}
    </section>
  );
}
