export function MomIndexPanel() {
  return (
    <section className="panel mom-index-panel" aria-labelledby="mom-index-title">
      <div>
        <span className="section-kicker">反向情绪观察</span>
        <h2 id="mom-index-title">宝妈指数</h2>
        <p>作为独立的市场情绪温度计，不参与候选排序。</p>
      </div>
      <div className="mom-status"><span>独立数据流</span><strong>等待接入</strong><small>不参与候选排序</small></div>
    </section>
  );
}
