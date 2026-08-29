import type { CandidateSource, CandidateSourceStatus, CandidateStock } from "../types";

type Props = {
  items: CandidateStock[];
  sources: CandidateSourceStatus[];
  refreshing: boolean;
  onOpenDetail: (symbol: string, trigger?: HTMLElement) => void;
  onRefresh: () => void;
};

const sourceId = "small_cap_absorption";

export function SmallCapAbsorptionPanel({
  items,
  sources,
  refreshing,
  onOpenDetail,
  onRefresh,
}: Props) {
  const absorptionItems = items.flatMap((item) => {
    const source = item.sources.find((candidate) => candidate.source_id === sourceId);
    return source ? [{ item, source }] : [];
  });
  const status = sources.find((source) => source.source_id === sourceId);

  return (
    <aside className="panel small-cap-panel" aria-labelledby="small-cap-title">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">独立规则池</span>
          <h2 id="small-cap-title">小市值倍量吸筹</h2>
        </div>
        <button className="refresh-action absorption" type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "运行中…" : "运行吸筹"}
        </button>
      </div>
      <div className="research-panel-body">
        {status?.status === "stale" && (
          <p className="source-alert source-alert-stale">沿用上一份小市值快照{status.error ? `：${status.error}` : ""}</p>
        )}
        {status?.status === "error" && (
          <p className="source-alert">小市值策略刷新失败{status.error ? `：${status.error}` : ""}</p>
        )}
        {status?.status === "not_configured" && (
          <p className="source-alert">小市值策略尚无可用快照</p>
        )}
        <div className="small-cap-list">
          {absorptionItems.map(({ item, source }) => (
            <SmallCapCandidateCard
              key={item.stock.symbol}
              item={item}
              source={source}
              onOpenDetail={onOpenDetail}
            />
          ))}
          {absorptionItems.length === 0 && (
            <p className="panel-empty">暂未发现符合条件的小市值首日倍量股票。</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function SmallCapCandidateCard({
  item,
  source,
  onOpenDetail,
}: {
  item: CandidateStock;
  source: CandidateSource;
  onOpenDetail: (symbol: string, trigger?: HTMLElement) => void;
}) {
  const factors = source.factors ?? {};
  const firstVolumeSpike = factors.first_volume_spike === true;

  return (
    <article className="small-cap-item">
      <div className="small-cap-item-title">
        <div><strong>{item.stock.name}</strong><span>{item.stock.symbol}</span></div>
        {firstVolumeSpike && <em>首日倍量</em>}
      </div>
      <dl className="small-cap-factors">
        <Factor label="总市值" value={formatMarketCap(factors.market_cap_yuan)} />
        <Factor label="触发日期" value={formatText(factors.trigger_date)} />
        <Factor label="倍量" value={formatMultiple(factors.volume_multiple)} />
        <Factor label="30日区间" value={formatPercent(factors.price_range_pct)} />
        <Factor label="最大回撤" value={formatPercent(factors.max_drawdown_pct)} />
      </dl>
      <p>{source.reasons.filter((reason) => reason !== "首日倍量").join(" · ")}</p>
      <button
        type="button"
        aria-label={`查看 ${item.stock.name} ${item.stock.symbol} 详情`}
        onClick={(event) => onOpenDetail(item.stock.symbol, event.currentTarget)}
      >查看依据</button>
    </article>
  );
}

function Factor({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatMarketCap(value: number | boolean | string | undefined): string {
  return typeof value === "number" ? `${(value / 100_000_000).toFixed(2)} 亿元` : "—";
}

function formatMultiple(value: number | boolean | string | undefined): string {
  return typeof value === "number" ? `${value.toFixed(2)} 倍` : "—";
}

function formatPercent(value: number | boolean | string | undefined): string {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "—";
}

function formatText(value: number | boolean | string | undefined): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}
