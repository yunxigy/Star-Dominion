import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNovelStore } from '../store/novelStore'
import { stageLabels } from '../lib/constants'
import api from '../api/client'

interface WritingStats {
  total_chapters: number
  total_words: number
  avg_chapter_words: number
  streak: number
}

export default function DashboardPage() {
  const { currentNovelId, status, config, loading, refreshStatus } = useNovelStore()
  const [stats, setStats] = useState<WritingStats | null>(null)

  useEffect(() => {
    if (currentNovelId) {
      refreshStatus()
      api.get(`/novels/${currentNovelId}/stats`)
        .then(({ data }) => setStats(data))
        .catch(() => setStats(null))
    }
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

  const stage = (status?.book_stage as string) || ''
  const chaptersWritten = (status?.chapters_written as number) || 0
  const currentArc = config?.current_arc || '-'
  const currentChapter = config?.current_chapter || '-'

  return (
    <div className="page dashboard-page">
      <h1>仪表盘</h1>
      {loading && <p>加载中...</p>}

      <div className="dashboard-grid">
        <div className="dash-card">
          <h3>写作阶段</h3>
          <p className="dash-value">{stage ? (stageLabels[stage] || stage) : '-'}</p>
        </div>
        <div className="dash-card">
          <h3>已写章节</h3>
          <p className="dash-value">{chaptersWritten}</p>
        </div>
        <div className="dash-card">
          <h3>总字数</h3>
          <p className="dash-value">{stats?.total_words?.toLocaleString() || '-'}</p>
        </div>
        <div className="dash-card">
          <h3>连续写作</h3>
          <p className="dash-value">{stats?.streak || 0} 天</p>
        </div>
      </div>

      <div className="dash-section">
        <h2>快捷操作</h2>
        <div className="dash-actions">
          <Link to="/ai" className="dash-action-btn">💬 AI 助手</Link>
          <Link to="/chapters" className="dash-action-btn">📖 章节管理</Link>
          <Link to="/worldview" className="dash-action-btn">🌍 世界观</Link>
          <Link to="/workflow" className="dash-action-btn">⚙️ 工作流</Link>
          <Link to="/tools" className="dash-action-btn">🧰 工具箱</Link>
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
