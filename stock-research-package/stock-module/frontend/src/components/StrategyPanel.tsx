import type { CandidateSourceStatus, CandidateStock } from "../types";

type Props = {
  items: CandidateStock[];
  sources: CandidateSourceStatus[];
  catalystSymbols: Set<string>;
  refreshing: boolean;
  onOpenDetail: (symbol: string, trigger?: HTMLElement) => void;
  onRefresh: () => void;
};

export function StrategyPanel({ items, sources, catalystSymbols, refreshing, onOpenDetail, onRefresh }: Props) {
  const strategyItems = items.flatMap((item) => {
    const strategy = item.sources.find((source) => source.source_id === "user_strategy");
    return strategy ? [{ item, strategy }] : [];
  });
  const status = sources.find((source) => source.source_id === "user_strategy");

  return (
    <aside className="panel strategy-panel" aria-labelledby="strategy-title">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">独立规则池</span>
          <h2 id="strategy-title">我的选股策略</h2>
        </div>
        <button className="refresh-action warm" type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "运行中…" : "运行策略"}
        </button>
      </div>
      {status && status.status !== "ok" && (
        <p className="source-alert">{status.status === "stale" ? "当前使用最近成功策略快照" : "策略尚无可用快照"}</p>
      )}
      <div className="strategy-list">
        {strategyItems.map(({ item, strategy }) => (
          <article className="strategy-item" key={item.stock.symbol}>
            <div className="strategy-item-title">
              <div><strong>{item.stock.name}</strong><span>{item.stock.symbol}</span></div>
              {catalystSymbols.has(item.stock.symbol) && <em>双重命中</em>}
            </div>
            <div className="strategy-score"><span>策略强度</span><b>{strategy.score?.toFixed(0) ?? "命中"}</b></div>
            <p>{strategy.reasons.join(" · ")}</p>
            <button
              type="button"
              aria-label={`查看 ${item.stock.name} ${catalystSymbols.has(item.stock.symbol) ? "策略详情" : "详情"}`}
              onClick={(event) => onOpenDetail(item.stock.symbol, event.currentTarget)}
            >查看依据</button>
          </article>
        ))}
        {strategyItems.length === 0 && <p className="panel-empty">暂未生成个人策略候选。</p>}
      </div>
    </aside>
  );
}
