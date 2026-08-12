import type { MorningReport } from "../types";
import { MarketSummary } from "./MarketSummary";
import { filterCatalystCandidates } from "../viewRules";

type Props = {
  report: MorningReport | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onOpenDetail: (symbol: string, trigger?: HTMLElement) => void;
};

export function MorningNewspaper({ report, loading, error, onBack, onOpenDetail }: Props) {
  const candidates = report ? filterCatalystCandidates(report.catalyst_candidates) : [];
  return (
    <main className="newspaper-page">
      <button className="newspaper-back" type="button" aria-label="返回晨报工作台" onClick={onBack}>← 返回晨报工作台</button>
      {loading && <p className="newspaper-state">正在装订完整晨报…</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {report && (
        <article className="newspaper-article">
          <header className="newspaper-masthead">
            <span>CATDESK 9 · MORNING RESEARCH</span>
            <h1>九点猫研每日报纸</h1>
            <div><time>{report.report_date}</time><span>上一交易日 {report.previous_trade_date}</span><span>{report.freshness === "stale" ? "历史成功快照" : "今日更新"}</span></div>
          </header>

          <section className="newspaper-lead" aria-labelledby="market-overview-title">
            <span className="newspaper-number">01</span>
            <div><h2 id="market-overview-title">昨夜市场概览</h2><MarketSummary className="newspaper-market-summary" text={report.market_summary} /></div>
          </section>

          <section className="newspaper-section" aria-labelledby="newspaper-news-title">
            <div className="newspaper-section-heading"><span className="newspaper-number">02</span><h2 id="newspaper-news-title">盘后至开盘前重要消息</h2></div>
            <div className="newspaper-news-list">
              {report.important_news.map((item, index) => (
                <article data-testid="newspaper-news" key={item.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <div className="news-meta"><time>{new Date(item.published_at).toLocaleString("zh-CN")}</time><span>{item.source}</span><b>{item.importance_score.toFixed(0)} 分</b></div>
                    <h3>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h3>
                    <p>{item.summary}</p>
                    <div className="chip-row">{item.themes.map((theme) => <span key={theme}>{theme}</span>)}{item.symbols.map((symbol) => <span className="symbol-chip" key={symbol}>{symbol}</span>)}</div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="newspaper-section" aria-labelledby="theme-map-title">
            <div className="newspaper-section-heading"><span className="newspaper-number">03</span><h2 id="theme-map-title">主题映射</h2></div>
            <div className="newspaper-theme-grid">
              {report.themes.map((theme) => (
                <article key={theme.id}><div><h3>{theme.name}</h3><strong>{theme.signal_score.toFixed(0)}</strong></div><p>{theme.logic}</p><small>{theme.summary} · 广度 {(theme.breadth * 100).toFixed(0)}%</small></article>
              ))}
            </div>
          </section>

          <section className="newspaper-section" aria-labelledby="candidate-evidence-title">
            <div className="newspaper-section-heading"><span className="newspaper-number">04</span><h2 id="candidate-evidence-title">九点猫研主板候选与完整依据</h2></div>
            <div className="newspaper-candidates">
              {candidates.map((candidate) => (
                <article key={candidate.symbol}>
                  <header><div><span>{candidate.symbol} · {candidate.exchange}</span><h3>{candidate.name}</h3><small>{candidate.industry} / {candidate.theme}</small></div><strong>{candidate.total_score.toFixed(0)}</strong></header>
                  <p>{candidate.rationale}</p>
                  {Object.keys(candidate.dimension_scores).length > 0 && <dl>{Object.entries(candidate.dimension_scores).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
                  <EvidenceRow title="正向催化" items={candidate.positive_flags} />
                  <EvidenceRow title="风险" items={candidate.risk_flags} risk />
                  <EvidenceRow title="无效条件" items={candidate.invalid_conditions} risk />
                  <button type="button" onClick={(event) => onOpenDetail(candidate.symbol, event.currentTarget)}>查看个股详情与分析入口</button>
                </article>
              ))}
              {candidates.length === 0 && <p className="panel-empty">当前没有得分大于 55 的九点猫研候选股。</p>}
            </div>
          </section>

          <footer className="newspaper-footer">
            <strong>研究边界</strong>
            <p>仅覆盖沪深 A 股主板，不含科创板、创业板和北交所。本报纸基于结构化公开数据与确定性规则生成，仅用于研究，不构成投资建议。</p>
          </footer>
        </article>
      )}
    </main>
  );
}

function EvidenceRow({ title, items, risk = false }: { title: string; items: string[]; risk?: boolean }) {
  if (items.length === 0) return null;
  return <div className={`newspaper-evidence-row ${risk ? "risk" : ""}`}><strong>{title}</strong><span>{items.join(" · ")}</span></div>;
}
