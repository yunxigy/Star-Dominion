import type { CandidateEvidence, MorningReportHistoryResponse } from "../types";

export function HistoryEvidence({ items, candidates, onOpenReport }: {
  items: MorningReportHistoryResponse["items"];
  candidates: CandidateEvidence[];
  onOpenReport: (date: string) => void;
}) {
  const sampleSizes = candidates.map((candidate) => Number(candidate.historical_stats.sample_size ?? 0));
  const totalSamples = sampleSizes.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return (
    <section className="panel history-panel" aria-labelledby="history-title">
      <div>
        <span className="section-kicker">可追溯，不只看结论</span>
        <h2 id="history-title">历史晨报与回测证据</h2>
      </div>
      <div className="history-metric"><strong>{totalSamples || "—"}</strong><span>当前候选公开历史样本</span></div>
      <div className="history-links">
        {items.slice(0, 6).map((item) => (
          <button type="button" onClick={() => onOpenReport(item.report_date)} key={item.report_date}>
            {item.report_date}<span>查看晨报</span>
          </button>
        ))}
        {items.length === 0 && <span className="muted-copy">暂无历史晨报</span>}
      </div>
    </section>
  );
}
