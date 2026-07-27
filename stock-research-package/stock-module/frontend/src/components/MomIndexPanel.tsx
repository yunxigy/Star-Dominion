import type { MomIndexSnapshot, MomSectorIndex } from "../types";

type AdminControls = {
  refreshing: boolean;
  onRefresh: () => void;
  onLogin: () => void;
  loginStatus?: string;
  qrCode?: string;
};

type Props = {
  snapshot: MomIndexSnapshot | null;
  history: MomIndexSnapshot[];
  error?: string;
  admin?: AdminControls;
};

const sectorOrder = ["nasdaq", "gold", "cpo", "semiconductor"] as const;

const sourceNames = {
  eastmoney: "东方财富",
  xiaohongshu: "小红书",
};

const riskNames: Record<MomSectorIndex["risk_level"], string> = {
  cold: "偏冷",
  normal: "正常",
  warming: "升温",
  warning: "警惕",
  extreme: "极热",
};

function trendPoints(history: MomIndexSnapshot[], sectorId: string): string {
  const values = history
    .slice()
    .reverse()
    .map((item) => item.sectors[sectorId]?.index)
    .filter((value): value is number => typeof value === "number");
  if (values.length < 2) return "";
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 36 - (Math.max(0, Math.min(100, value)) / 100) * 32;
      return `${x},${y}`;
    })
    .join(" ");
}

function SectorCard({
  sector,
  history,
}: {
  sector: MomSectorIndex;
  history: MomIndexSnapshot[];
}) {
  const points = trendPoints(history, sector.sector_id);
  return (
    <article className={`mom-sector-card risk-${sector.risk_level}`}>
      <header>
        <div>
          <span>{sector.name}</span>
          <strong>{sector.index.toFixed(1)}</strong>
        </div>
        <em>{riskNames[sector.risk_level]}</em>
      </header>
      <svg className="mom-sparkline" viewBox="0 0 100 40" role="img" aria-label={`${sector.name}历史趋势`}>
        <path d="M0 36H100" />
        {points && <polyline points={points} />}
      </svg>
      <dl>
        <div><dt>新手占比</dt><dd>{sector.newbie_ratio.toFixed(1)}%</dd></div>
        <div><dt>买入意向</dt><dd>{sector.buy_index.toFixed(1)}</dd></div>
        <div><dt>卖出意向</dt><dd>{sector.sell_index.toFixed(1)}</dd></div>
        <div><dt>有效帖子</dt><dd>{sector.valid_posts}</dd></div>
      </dl>
      <p>{sector.interpretation}</p>
    </article>
  );
}

export function MomIndexPanel({ snapshot, history, error, admin }: Props) {
  return (
    <section className="panel mom-index-panel" aria-labelledby="mom-index-title">
      <div className="mom-index-heading">
        <div>
          <span className="section-kicker">真实社区情绪 · 每日 08:30</span>
          <h2 id="mom-index-title">宝妈指数</h2>
          <p>东方财富与小红书真实公开内容汇总，仅作反向情绪观察。<strong className="mom-independence">不参与候选排序</strong></p>
        </div>
        {admin && (
          <div className="mom-admin-actions">
            <button className="secondary-button" onClick={admin.onLogin}>重新登录小红书</button>
            <button className="refresh-action" disabled={admin.refreshing} onClick={admin.onRefresh}>
              {admin.refreshing ? "正在刷新…" : "立即刷新宝妈指数"}
            </button>
          </div>
        )}
      </div>

      {error && !snapshot && <p className="source-alert" role="alert">{error}</p>}
      {!snapshot && !error && <p className="panel-empty">尚无真实快照，系统将在每日 08:30 自动采集。</p>}
      {snapshot && (
        <>
          {snapshot.stale && <p className="mom-stale-banner">当前展示最近真实快照</p>}
          <div className="mom-sector-grid">
            {sectorOrder.map((sectorId) => snapshot.sectors[sectorId])
              .filter((sector): sector is MomSectorIndex => Boolean(sector))
              .map((sector) => <SectorCard key={sector.sector_id} sector={sector} history={history} />)}
          </div>
          <div className="mom-source-strip">
            <div>
              <strong>数据来源</strong>
              <span>{snapshot.snapshot_date} · {snapshot.completeness === "complete" ? "双源完整" : "部分可用"}</span>
            </div>
            {snapshot.sources.map((source) => (
              <div className={`mom-source source-${source.status}`} key={source.source_id}>
                <strong>{sourceNames[source.source_id]}</strong>
                <span>
                  {source.status === "ok"
                    ? `已采集 ${source.post_count} 条`
                    : source.source_id === "xiaohongshu" && source.status === "login_required"
                      ? "小红书需要重新登录"
                      : source.message ?? "采集暂不可用"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {admin?.loginStatus && <p className="inline-message" role="status">{admin.loginStatus}</p>}
      {admin?.qrCode && (
        <div className="mom-login-qr">
          <img src={admin.qrCode} alt="小红书登录二维码" />
          <div><strong>用小红书扫码登录</strong><span>登录态仅保存在服务器本地数据目录。</span></div>
        </div>
      )}
    </section>
  );
}
