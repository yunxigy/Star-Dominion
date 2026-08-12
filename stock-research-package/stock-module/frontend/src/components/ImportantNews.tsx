import type { ImportantNewsItem } from "../types";

function timeOf(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function ImportantNews({ items, onReadNewspaper }: { items: ImportantNewsItem[]; onReadNewspaper: () => void }) {
  return (
    <section className="panel news-panel" aria-labelledby="news-title">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">上一交易日 15:00 — 今日 09:30</span>
          <h2 id="news-title">盘后至开盘前重要消息</h2>
        </div>
        <button className="text-action" type="button" onClick={onReadNewspaper}>阅读每日报纸 <span aria-hidden="true">→</span></button>
      </div>
      <div className="research-panel-body">
      <div className="news-list">
        {items.slice(0, 8).map((item, index) => (
          <article className={`news-item tone-${item.tone}`} data-testid="news-summary" key={item.id}>
            <span className="news-rank">{String(index + 1).padStart(2, "0")}</span>
            <div className="news-copy">
              <div className="news-meta"><time>{timeOf(item.published_at)}</time><span>{item.source}</span></div>
              <h3>{item.title}</h3>
              <p>{item.summary}</p>
              <div className="chip-row">
                {item.themes.map((theme) => <span key={theme}>{theme}</span>)}
                {item.symbols.map((symbol) => <span className="symbol-chip" key={symbol}>{symbol}</span>)}
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="panel-empty">当前时间窗内暂无达到阈值的重要消息。</p>}
      </div>
      </div>
    </section>
  );
}
