type Props = {
  generatedAt: string | null;
  freshness: "current" | "stale" | null;
  onOpenSettings: () => void;
};

function formatTime(value: string | null) {
  if (!value) return "等待首份晨报";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function WorkspaceHeader({ generatedAt, freshness, onOpenSettings }: Props) {
  return (
    <header className="workspace-header">
      <div className="workspace-brand">
        <span className="cat-mark" aria-hidden="true">九</span>
        <div>
          <strong>股票研究工作台</strong>
          <span>九点猫研 · A 股主板</span>
        </div>
      </div>
      <div className="workspace-actions">
        <div className="data-clock">
          <span>最近更新</span>
          <strong>{formatTime(generatedAt)}</strong>
          {freshness && <i className={`freshness-dot ${freshness}`}>{freshness === "current" ? "数据新鲜" : "历史快照"}</i>}
        </div>
        <button
          className="outline-button api-config-button"
          type="button"
          onClick={onOpenSettings}
          title="填写、测试并保存硅基流动或其他兼容服务的 API"
        >
          API 配置
        </button>
      </div>
    </header>
  );
}
