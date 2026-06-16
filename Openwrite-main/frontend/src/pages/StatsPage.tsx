import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'
import NoNovelGuard from '../components/NoNovelGuard'

interface DailyStat {
  date: string
  chapters: number
  chars: number
  words: number
}

interface ChapterStat {
  chapter_id: string
  title: string
  chars: number
  words: number
  modified: string
}

interface WritingStats {
  total_chapters: number
  total_chars: number
  total_words: number
  avg_chapter_words: number
  chapters: ChapterStat[]
  daily_stats: DailyStat[]
  velocity: DailyStat[]
  streak: number
  longest_chapter: ChapterStat | null
  shortest_chapter: ChapterStat | null
}

export default function StatsPage() {
  const { currentNovelId } = useNovelStore()
  const [stats, setStats] = useState<WritingStats | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/stats`)
      .then(({ data }) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [currentNovelId])

  if (loading) return <NoNovelGuard><div className="page"><p>加载中...</p></div></NoNovelGuard>
  if (!stats) return <NoNovelGuard><div className="page"><p>暂无数据。</p></div></NoNovelGuard>

  const maxWords = Math.max(...(stats.velocity.map(v => v.words) || [1]), 1)

  return (
    <NoNovelGuard>
    <div className="page stats-page">
      <h1>写作统计</h1>

      {/* 概览卡片 */}
      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-value">{stats.total_chapters}</div>
          <div className="stat-label">总章节</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.total_words.toLocaleString()}</div>
          <div className="stat-label">总字数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.avg_chapter_words.toLocaleString()}</div>
          <div className="stat-label">均章字数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.streak}</div>
          <div className="stat-label">连续写作天数</div>
        </div>
      </div>

      {/* 近 7 天字数柱状图 */}
      <div className="stats-section">
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

      {/* 极值 */}
      <div className="stats-section">
        <h2>极值</h2>
        <div className="extremes">
          {stats.longest_chapter && (
            <div className="extreme-item">
              <span className="extreme-label">最长章节:</span>
              <span className="extreme-value">
                {stats.longest_chapter.title} ({stats.longest_chapter.words.toLocaleString()} 字)
              </span>
            </div>
          )}
          {stats.shortest_chapter && (
            <div className="extreme-item">
              <span className="extreme-label">最短章节:</span>
              <span className="extreme-value">
                {stats.shortest_chapter.title} ({stats.shortest_chapter.words.toLocaleString()} 字)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 章节明细 */}
      <div className="stats-section">
        <h2>章节明细</h2>
        <div className="chapter-table">
          <div className="table-header">
            <span className="col-id">ID</span>
            <span className="col-title">标题</span>
            <span className="col-words">字数</span>
            <span className="col-date">更新时间</span>
          </div>
          {stats.chapters.map((ch) => (
            <div key={ch.chapter_id} className="table-row">
              <span className="col-id">{ch.chapter_id}</span>
              <span className="col-title">{ch.title}</span>
              <span className="col-words">{ch.words.toLocaleString()}</span>
              <span className="col-date">{ch.modified.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .stats-page { max-width: 900px; }
        .stats-cards {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px;
          margin: 20px 0;
        }
        .stat-card {
          background: #fff; border: 1px solid #e0e0e0; border-radius: 12px;
          padding: 20px; text-align: center;
        }
        .stat-value {
          font-size: 28px; font-weight: 700; color: #7c8aff;
          margin-bottom: 4px;
        }
        .stat-label { font-size: 13px; color: #888; }
        .stats-section {
          background: #fff; border: 1px solid #e0e0e0; border-radius: 12px;
          padding: 20px; margin: 16px 0;
        }
        .stats-section h2 {
          margin: 0 0 16px; font-size: 16px; color: #333;
        }
        .velocity-chart {
          display: flex; gap: 12px; align-items: flex-end; height: 160px;
          padding: 0 8px;
        }
        .bar-group {
          flex: 1; display: flex; flex-direction: column; align-items: center;
        }
        .bar-container {
          width: 100%; height: 130px; display: flex; align-items: flex-end;
        }
        .bar {
          width: 100%; background: linear-gradient(180deg, #7c8aff, #a5b4fc);
          border-radius: 6px 6px 0 0; position: relative;
          transition: height 0.3s;
          min-height: 2px;
        }
        .bar-value {
          position: absolute; top: -20px; left: 50%; transform: translateX(-50%);
          font-size: 11px; color: #555; white-space: nowrap;
        }
        .bar-label { font-size: 11px; color: #888; margin-top: 6px; }
        .extremes { display: flex; flex-direction: column; gap: 8px; }
        .extreme-item { font-size: 14px; }
        .extreme-label { color: #888; margin-right: 8px; }
        .extreme-value { color: #333; font-weight: 500; }
        .chapter-table {
          border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;
        }
        .table-header, .table-row {
          display: grid; grid-template-columns: 80px 1fr 100px 100px;
          padding: 10px 16px; gap: 12px; font-size: 13px;
        }
        .table-header {
          background: #fafafa; font-weight: 600; color: #666;
          border-bottom: 1px solid #e0e0e0;
        }
        .table-row {
          border-bottom: 1px solid #f0f0f0;
        }
        .table-row:hover { background: #f5f5ff; }
        .col-id { color: #888; }
        .col-words { text-align: right; }
        .col-date { color: #aaa; font-size: 12px; }
      `}</style>
    </div>
    </NoNovelGuard>
  )
}
