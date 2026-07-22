import { useEffect, useRef, useState } from "react";

import { loadStockResearchContext } from "../api";
import type { AnalysisTask, ModelProfile, StockResearchContext } from "../types";
import { AnalysisControls } from "./AnalysisControls";

type Props = {
  symbol: string | null;
  profiles: ModelProfile[];
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onStarted: (task: AnalysisTask) => void;
  onOpenSettings: () => void;
};

const dimensionNames: Record<string, string> = {
  catalyst: "催化强度",
  history: "历史优势",
  technical: "技术形态",
  fundamental: "基本面",
  news: "新闻驱动",
};

export function StockDetailDrawer({ symbol, profiles, returnFocus, onClose, onStarted, onOpenSettings }: Props) {
  const [context, setContext] = useState<StockResearchContext | null>(null);
  const [error, setError] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!symbol) return;
    let active = true;
    setContext(null);
    setError("");
    void loadStockResearchContext(symbol)
      .then((value) => { if (active) setContext(value); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
    };
  // close intentionally follows the current render's focus target.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (!symbol) return null;

  function close() {
    onClose();
    queueMicrotask(() => returnFocus?.focus());
  }

  const catalyst = context?.catalyst;

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="stock-drawer" role="dialog" aria-modal="true" aria-label="股票研究详情">
        <header className="drawer-heading">
          <div>
            <span className="section-kicker">A 股主板 · 结构化研究上下文</span>
            <h2>{context?.name ?? symbol}</h2>
            <p>{symbol}{context ? ` · ${context.exchange}` : ""}</p>
          </div>
          <button ref={closeButton} className="icon-button" type="button" aria-label="关闭股票详情" onClick={close}>×</button>
        </header>

        {error && <p className="inline-error" role="alert">{error}</p>}
        {!context && !error && <p className="drawer-loading">正在加载选股依据…</p>}
        {context && (
          <div className="drawer-evidence">
            <div className="validation-row"><span>主板校验通过</span>{context.cross_hit && <strong>九研与策略双重命中</strong>}</div>
            {context.sources.map((source) => (
              <section className={`source-evidence source-${source.source_id}`} key={source.source_id}>
                <div><h3>{source.source_name}</h3><b>{source.score?.toFixed(0) ?? "规则命中"}</b></div>
                <ul>{source.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </section>
            ))}
            {catalyst && (
              <>
                <section className="evidence-section">
                  <h3>九研评分拆解</h3>
                  <div className="dimension-grid">
                    {Object.entries(catalyst.dimension_scores).map(([name, value]) => (
                      <span key={name}>{dimensionNames[name] ?? name} {value}</span>
                    ))}
                  </div>
                  <p className="full-rationale">{catalyst.rationale}</p>
                </section>
                {catalyst.positive_flags.length > 0 && <EvidenceList title="正向催化" items={catalyst.positive_flags} tone="positive" />}
                {catalyst.risk_flags.length > 0 && <EvidenceList title="风险" items={catalyst.risk_flags} tone="risk" prefix="风险：" />}
                {catalyst.invalid_conditions.length > 0 && <EvidenceList title="无效条件" items={catalyst.invalid_conditions} tone="neutral" />}
                {catalyst.news.length > 0 && (
                  <section className="evidence-section"><h3>关联消息</h3>{catalyst.news.map((item) => <p key={item.id}>{item.title}</p>)}</section>
                )}
              </>
            )}
            {context.sources.length === 0 && !catalyst && (
              <p className="no-source-evidence">该股票未命中今天的九研或个人策略，但仍可选择模型进行独立详细分析。</p>
            )}
          </div>
        )}

        <AnalysisControls
          symbol={symbol}
          profiles={profiles}
          submitLabel="生成个股详细分析"
          onStarted={onStarted}
          onOpenSettings={onOpenSettings}
        />
      </section>
    </div>
  );
}

function EvidenceList({ title, items, tone, prefix = "" }: { title: string; items: string[]; tone: string; prefix?: string }) {
  return (
    <section className="evidence-section">
      <h3>{title}</h3>
      <div className={`evidence-pills ${tone}`}>{items.map((item) => <span key={item}>{prefix}{item}</span>)}</div>
    </section>
  );
}
