import type { MorningReportHistoryResponse } from "../types";

export function HistoryEvidence({ items, onOpenReport }: {
  items: MorningReportHistoryResponse["items"];
  onOpenReport: (date: string) => void;
}) {
  return (
    <section className="panel history-panel history-panel--aligned" aria-labelledby="history-title">
      <div className="history-heading">
        <span className="section-kicker">可追溯，不只看结论</span>
        <h2 className="history-title" id="history-title">历史晨报与回测证据</h2>
      </div>
      <div className="history-links">
        {items.slice(0, 5).map((item) => (
          <button className="history-report-link" type="button" onClick={() => onOpenReport(item.report_date)} key={item.report_date}>
            {item.report_date}<span>查看晨报</span>
          </button>
        ))}
        {items.length === 0 && <span className="muted-copy">暂无历史晨报</span>}
      </div>
    </section>
  );
}
