import type { StockKline } from "../types";


type StockQuoteSummaryProps = {
  kline: StockKline;
};


function formatPrice(value: number) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSigned(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatPrice(value)}`;
}


function formatVolume(value: number) {
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)}亿`;
  }
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(2)}万`;
  }
  return value.toLocaleString("zh-CN");
}


export function StockQuoteSummary({ kline }: StockQuoteSummaryProps) {
  const movement = kline.latest.change > 0 ? "up" : kline.latest.change < 0 ? "down" : "flat";
  const percentSign = kline.latest.change_pct > 0 ? "+" : "";

  return (
    <section className="stock-quote-summary" aria-label={`${kline.name} 最新行情`}>
      <div className="stock-quote-primary">
        <span>最新价</span>
        <strong className={movement}>{formatPrice(kline.latest.price)}</strong>
        <em className={movement}>
          {formatSigned(kline.latest.change)}（{percentSign}{kline.latest.change_pct.toFixed(2)}%）
        </em>
      </div>
      <dl className="stock-quote-metrics">
        <div>
          <dt>最高</dt>
          <dd>{formatPrice(kline.latest.high)}</dd>
        </div>
        <div>
          <dt>最低</dt>
          <dd>{formatPrice(kline.latest.low)}</dd>
        </div>
        <div>
          <dt>成交量</dt>
          <dd>{formatVolume(kline.latest.volume)}</dd>
        </div>
        <div>
          <dt>交易日</dt>
          <dd>{kline.latest.trade_date}</dd>
        </div>
      </dl>
      <div className="stock-quote-freshness">
        <span>更新于 {kline.generated_at.replace("T", " ").slice(0, 19)}</span>
        {kline.stale ? <strong>最近缓存</strong> : <span>东方财富真实日线</span>}
      </div>
    </section>
  );
}
