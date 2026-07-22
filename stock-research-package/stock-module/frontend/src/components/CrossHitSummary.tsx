import type { CandidateEvidence, CandidateStock } from "../types";

export function CrossHitSummary({ catalystCandidates, candidateItems, onOpenDetail }: {
  catalystCandidates: CandidateEvidence[];
  candidateItems: CandidateStock[];
  onOpenDetail: (symbol: string, trigger?: HTMLElement) => void;
}) {
  const names = new Map(catalystCandidates.map((item) => [item.symbol, item.name]));
  const hits = candidateItems.filter((item) =>
    names.has(item.stock.symbol) && item.sources.some((source) => source.source_id === "user_strategy"),
  );
  return (
    <section className="panel cross-hit-panel" aria-labelledby="cross-hit-title">
      <div>
        <span className="section-kicker">两套逻辑，独立计分</span>
        <h2 id="cross-hit-title">九研 × 我的策略 · 交叉命中</h2>
      </div>
      <div className="cross-hit-list">
        {hits.map((item) => (
          <button type="button" key={item.stock.symbol} onClick={(event) => onOpenDetail(item.stock.symbol, event.currentTarget)}>
            <span>{item.stock.symbol}</span><strong>{names.get(item.stock.symbol) ?? item.stock.name}</strong><em>查看双重依据 →</em>
          </button>
        ))}
        {hits.length === 0 && <p className="panel-empty">今天两套体系暂无交叉命中。</p>}
      </div>
    </section>
  );
}
