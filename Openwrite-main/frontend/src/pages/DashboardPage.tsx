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
  velocity: { date: string; words: number }[]
  chapters: { chapter_id: string; title: string; words: number; modified: string }[]
  longest_chapter: { chapter_id: string; title: string; words: number } | null
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
  const maxWords = Math.max(...(stats?.velocity?.map(v => v.words) || [1]), 1)

  return (
    <div className="page dashboard-page">
      <h1>仪表盘</h1>
      {loading && <p>加载中...</p>}

      {/* 核心数据卡片 */}
      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-card-icon">📝</div>
          <div className="dash-card-value">{chaptersWritten}</div>
          <div className="dash-card-label">已写章节</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-icon">✍️</div>
          <div className="dash-card-value">{stats?.total_words?.toLocaleString() || '-'}</div>
          <div className="dash-card-label">总字数</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-icon">📊</div>
          <div className="dash-card-value">{stats?.avg_chapter_words?.toLocaleString() || '-'}</div>
          <div className="dash-card-label">均章字数</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-icon">🔥</div>
          <div className="dash-card-value">{stats?.streak || 0}</div>
          <div className="dash-card-label">连续写作天数</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-icon">🎬</div>
          <div className="dash-card-value">{stage ? (stageLabels[stage] || stage) : '-'}</div>
          <div className="dash-card-label">当前阶段</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-icon">📚</div>
          <div className="dash-card-value">{currentArc}</div>
          <div className="dash-card-label">当前卷</div>
        </div>
      </div>

      {/* 近 7 天柱状图 */}
      {stats?.velocity && stats.velocity.some(v => v.words > 0) && (
        <div className="dash-section">
          <h2>近 7 天写作量</h2>
          <div className="velocity-chart">
            {stats.velocity.map((day) => (
              <div key={day.date} className="bar-group">
                <div className="bar-container">
                  <div
                    className="bar"
                    style={{ height: `${Math.max((day.words / maxWords) * 100, 2)}%` }}
                  >
                    {day.words > 0 && <span className="bar-value">{day.words}</span>}
                  </div>
                </div>
                <div className="bar-label">{day.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最近章节 */}
      {stats?.chapters && stats.chapters.length > 0 && (
        <div className="dash-section">
          <h2>最近章节</h2>
          <div className="recent-chapters">
            {stats.chapters.slice(-5).reverse().map((ch) => (
              <div key={ch.chapter_id} className="recent-chapter-item">
                <span className="ch-id">{ch.chapter_id}</span>
                <span className="ch-title">{ch.title}</span>
                <span className="ch-words">{ch.words.toLocaleString()} 字</span>
                <span className="ch-date">{ch.modified?.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快捷操作 */}
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

      {/* 小说信息 */}
      <div className="dash-section">
        <h2>小说信息</h2>
        <div className="novel-info">
          <div className="info-row">
            <span className="info-label">小说 ID</span>
            <span className="info-value">{currentNovelId}</span>
          </div>
          <div className="info-row">
            <span className="info-label">当前章节</span>
            <span className="info-value">{currentChapter}</span>
          </div>
          <div className="info-row">
            <span className="info-label">最长章节</span>
            <span className="info-value">
              {stats?.longest_chapter
                ? `${stats.longest_chapter.title} (${stats.longest_chapter.words.toLocaleString()} 字)`
                : '-'}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        .dashboard-page h1 {
          text-align: center;
          font-size: 28px;
          margin-bottom: 24px;
        }

        .dash-cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 32px;
        }

        .dash-card {
          background: #fff;
          border-radius: 16px;
          padding: 28px 20px;
          text-align: center;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
          transition: transform 0.15s, box-shadow 0.15s;
        }

        .dash-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }

        .dash-card-icon {
          font-size: 32px;
          margin-bottom: 8px;
        }

        .dash-card-value {
          font-size: 32px;
          font-weight: 800;
          color: #1a1a2e;
          margin-bottom: 4px;
          line-height: 1.2;
        }

        .dash-card-label {
          font-size: 14px;
          color: #888;
          font-weight: 500;
        }

        .dash-section {
          background: #fff;
          border-radius: 16px;
          padding: 24px;
          margin-bottom: 20px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        }

        .dash-section h2 {
          margin: 0 0 16px;
          font-size: 18px;
          color: #333;
        }

        .velocity-chart {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          height: 160px;
          padding: 0 8px;
        }

        .bar-group {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .bar-container {
          width: 100%;
          height: 130px;
          display: flex;
          align-items: flex-end;
        }

        .bar {
          width: 100%;
          background: linear-gradient(180deg, #7c8aff, #a5b4fc);
          border-radius: 6px 6px 0 0;
          position: relative;
          transition: height 0.3s;
          min-height: 2px;
        }

        .bar-value {
          position: absolute;
          top: -20px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          color: #555;
          white-space: nowrap;
        }

        .bar-label {
          font-size: 11px;
          color: #888;
          margin-top: 6px;
        }

        .recent-chapters {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .recent-chapter-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          background: #f8f9fa;
          font-size: 14px;
        }

        .recent-chapter-item:hover {
          background: #f0f0f5;
        }

        .ch-id {
          font-size: 12px;
          color: #888;
          min-width: 60px;
        }

        .ch-title {
          flex: 1;
          font-weight: 500;
        }

        .ch-words {
          font-size: 12px;
          color: #888;
          min-width: 80px;
          text-align: right;
        }

        .ch-date {
          font-size: 12px;
          color: #aaa;
          min-width: 80px;
          text-align: right;
        }

        .dash-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }

        .dash-action-btn {
          padding: 12px 24px;
          background: #7c8aff;
          color: #fff;
          border-radius: 10px;
          text-decoration: none;
          font-size: 15px;
          font-weight: 500;
          transition: all 0.15s;
        }

        .dash-action-btn:hover {
          background: #5a6ae0;
          transform: translateY(-1px);
          text-decoration: none;
        }

        .novel-info {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid #f0f0f0;
        }

        .info-label {
          color: #888;
          font-size: 14px;
        }

        .info-value {
          font-weight: 500;
          font-size: 14px;
        }

        @media (max-width: 768px) {
          .dash-cards {
            grid-template-columns: repeat(2, 1fr);
          }
        }
      `}</style>
    </div>
  )
}
