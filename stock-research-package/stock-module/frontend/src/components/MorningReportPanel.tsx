import type { MorningReport } from "../types";
import { MarketSummary } from "./MarketSummary";

type Props = {
  report: MorningReport | null;
  error: string;
  refreshing: boolean;
  onOpenDetail: (symbol: string, trigger?: HTMLElement) => void;
  onRefresh: () => void;
};

export function MorningReportPanel({ report, error, refreshing, onOpenDetail, onRefresh }: Props) {
  return (
    <section className="panel morning-panel" aria-labelledby="morning-title">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">昨夜美股 → 今日 A 股</span>
          <h1 id="morning-title">九点猫研 · 今日晨报</h1>
        </div>
        <button className="refresh-action" type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "刷新中…" : "运行九点猫研"}
        </button>
      </div>

      {error && <p className="source-alert" role="alert">{error}</p>}
      {!report && !error && <p className="panel-empty">正在载入今日晨报…</p>}
      {!report && error && <p className="panel-empty">晨报暂不可用，右侧个人策略不受影响。</p>}

      {report && (
        <>
          {report.freshness === "stale" && (
            <p className="stale-banner">当前展示最近成功晨报</p>
          )}
          <MarketSummary text={report.market_summary} />
          <div className="theme-strip" aria-label="主题强度">
            {report.themes.slice(0, 4).map((theme) => (
              <article key={theme.id}>
                <span>{theme.name}</span>
                <strong>{theme.signal_score.toFixed(0)}</strong>
                <small>{theme.logic || theme.summary}</small>
              </article>
            ))}
          </div>
          <div className="candidate-table-wrap">
            <table className="candidate-table">
              <thead>
                <tr><th>股票</th><th>主题</th><th>九研分</th><th>选股依据</th><th /></tr>
              </thead>
              <tbody>
                {report.catalyst_candidates.map((candidate) => (
                  <tr key={candidate.symbol}>
                    <td><strong>{candidate.name}</strong><span>{candidate.symbol} · {candidate.exchange}</span></td>
                    <td><span className="theme-chip">{candidate.theme}</span></td>
                    <td><b className="score-value">{candidate.total_score.toFixed(0)}</b></td>
                    <td><p>{candidate.rationale}</p></td>
                    <td><button type="button" aria-label={`查看 ${candidate.name} 详情`} onClick={(event) => onOpenDetail(candidate.symbol, event.currentTarget)}>详情</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
