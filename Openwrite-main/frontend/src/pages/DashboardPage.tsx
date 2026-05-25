import { useEffect } from 'react'
import { useNovelStore } from '../store/novelStore'

export default function DashboardPage() {
  const { currentNovelId, status, config, loading, refreshStatus } = useNovelStore()

  useEffect(() => {
    if (currentNovelId) refreshStatus()
  }, [currentNovelId, refreshStatus])

  if (!currentNovelId) {
    return (
      <div className="page">
        <h1>仪表盘</h1>
        <div className="help-box">
          <p>尚未选择小说。请先在顶部选择一本小说，或通过 CLI 运行 <code>openwrite goethe</code> 创建新项目。</p>
        </div>
      </div>
    )
  }

  const stage = (status?.book_stage as string) || '未知'
  const chaptersWritten = (status?.chapters_written as number) || 0
  const currentArc = config?.current_arc || '-'
  const currentChapter = config?.current_chapter || '-'

  const stageLabels: Record<string, string> = {
    DISCOVERY: '探索期',
    FOUNDATION: '奠基期',
    ROLLING_OUTLINE: '滚动大纲',
    CHAPTER_PREFLIGHT: '章节预检',
    DRAFTING: '写作中',
    REVIEW_AND_REVISE: '审查修订',
    SETTLEMENT: '状态结算',
    MILESTONE_REVIEW: '里程碑审查',
  }

  return (
    <div className="page dashboard-page">
      <h1>仪表盘</h1>
      <div className="help-box">
        <p>这里是项目的总览页面。你可以查看当前写作阶段、已写章节数、卷/章进度，并快速跳转到常用功能。</p>
      </div>
      {loading && <p>加载中...</p>}

      <div className="dashboard-grid">
        <div className="dash-card">
          <h3>写作阶段</h3>
          <p className="dash-value">{stageLabels[stage] || stage}</p>
        </div>
        <div className="dash-card">
          <h3>已写章节</h3>
          <p className="dash-value">{chaptersWritten}</p>
        </div>
        <div className="dash-card">
          <h3>当前卷</h3>
          <p className="dash-value">{currentArc}</p>
        </div>
        <div className="dash-card">
          <h3>当前章节</h3>
          <p className="dash-value">{currentChapter}</p>
        </div>
      </div>

      <div className="dash-section">
        <h2>快捷操作</h2>
        <div className="dash-actions">
          <a href="chat" className="dash-action-btn">打开 Dante 对话</a>
          <a href="chapters" className="dash-action-btn">查看章节列表</a>
          <a href="outline" className="dash-action-btn">编辑大纲</a>
          <a href="workflow" className="dash-action-btn">查看工作流</a>
        </div>
      </div>

      <style>{`
        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 16px;
          margin: 24px 0;
        }
        .dash-card {
          background: #fff;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .dash-card h3 {
          margin: 0 0 8px;
          font-size: 13px;
          color: #666;
          text-transform: uppercase;
        }
        .dash-value {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          color: #1a1a2e;
        }
        .dash-section { margin-top: 32px; }
        .dash-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .dash-action-btn {
          padding: 10px 20px;
          background: #7c8aff;
          color: #fff;
          border-radius: 6px;
          text-decoration: none;
          font-size: 14px;
          transition: background 0.15s;
        }
        .dash-action-btn:hover { background: #5a6ae0; text-decoration: none; }
      `}</style>
    </div>
  )
}
