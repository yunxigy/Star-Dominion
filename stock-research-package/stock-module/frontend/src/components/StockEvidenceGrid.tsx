import type { StockResearchContext } from "../types";

const dimensionNames: Record<string, string> = {
  catalyst: "催化强度",
  history: "历史优势",
  technical: "技术形态",
  fundamental: "基本面",
  news: "新闻驱动",
};

type Props = {
  context: StockResearchContext;
};

export function StockEvidenceGrid({ context }: Props) {
  const catalyst = context.catalyst;

  return (
    <div className="stock-evidence-grid">
      <div className="validation-row">
        <span>主板校验通过</span>
        {context.cross_hit && <strong>九研与策略双重命中</strong>}
      </div>
      {context.sources.map((source) => (
        <section className={`source-evidence source-${source.source_id}`} key={source.source_id}>
          <div>
            <h3>{source.source_name}</h3>
            <b>{source.score?.toFixed(0) ?? "规则命中"}</b>
          </div>
          <ul>{source.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </section>
      ))}
      {catalyst && (
        <>
          <section className="evidence-section evidence-score-breakdown">
            <h3>九研评分拆解</h3>
            <div className="dimension-grid">
              {Object.entries(catalyst.dimension_scores).map(([name, value]) => (
                <span key={name}>{dimensionNames[name] ?? name} {value}</span>
              ))}
            </div>
            <p className="full-rationale">{catalyst.rationale}</p>
          </section>
          {catalyst.positive_flags.length > 0 && (
            <EvidenceList title="正向催化" items={catalyst.positive_flags} tone="positive" />
          )}
          {catalyst.risk_flags.length > 0 && (
            <EvidenceList title="风险" items={catalyst.risk_flags} tone="risk" prefix="风险：" />
          )}
          {catalyst.invalid_conditions.length > 0 && (
            <EvidenceList title="无效条件" items={catalyst.invalid_conditions} tone="neutral" />
          )}
          {catalyst.news.length > 0 && (
            <section className="evidence-section">
              <h3>关联消息</h3>
              {catalyst.news.map((item) => <p key={item.id}>{item.title}</p>)}
            </section>
          )}
        </>
      )}
      {context.sources.length === 0 && !catalyst && (
        <p className="no-source-evidence">
          该股票未命中今天的九研或个人策略，但仍可选择模型进行独立详细分析。
        </p>
      )}
    </div>
  );
}

function EvidenceList({
  title,
  items,
  tone,
  prefix = "",
}: {
  title: string;
  items: string[];
  tone: string;
  prefix?: string;
}) {
  return (
    <section className="evidence-section">
      <h3>{title}</h3>
      <div className={`evidence-pills ${tone}`}>
        {items.map((item) => <span key={item}>{prefix}{item}</span>)}
      </div>
    </section>
  );
}
