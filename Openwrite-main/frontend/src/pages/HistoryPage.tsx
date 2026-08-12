import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'
import NoNovelGuard from '../components/NoNovelGuard'

interface Version {
  filename: string
  version: number
  timestamp: string
  reason: string
  char_count: number
}

interface DiffResult {
  version_a: number
  version_b: number
  diff_html: string
  diff_plain: string
  stats: {
    added_lines: number
    removed_lines: number
    changed_lines: number
  }
}

export default function HistoryPage() {
  const { currentNovelId } = useNovelStore()
  const [chapterId, setChapterId] = useState('')
  const [chapterList, setChapterList] = useState<{ chapter_id: string; title: string }[]>([])
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(false)
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [, setSelectedV1] = useState<number | null>(null)
  const [, setSelectedV2] = useState<number | null>(null)

  const loadVersions = async () => {
    if (!currentNovelId || !chapterId.trim()) return
    setLoading(true)
    try {
      const { data } = await api.get(`/novels/${currentNovelId}/chapters/${chapterId}/history`)
      setVersions(data.versions || [])
    } catch {
      setVersions([])
    } finally {
      setLoading(false)
    }
  }

  // Load chapter list on mount
  useEffect(() => {
    if (!currentNovelId) return
    api.get(`/novels/${currentNovelId}/export/chapters`)
      .then(({ data }) => setChapterList(data.chapters || []))
      .catch(() => setChapterList([]))
  }, [currentNovelId])

  useEffect(() => {
    setVersions([])
    setDiffResult(null)
    setSelectedV1(null)
    setSelectedV2(null)
  }, [chapterId])

  const handleDiff = async (v1: number, v2: number) => {
    if (!currentNovelId || !chapterId) return
    setDiffLoading(true)
    setDiffResult(null)
    try {
      const { data } = await api.get(
        `/novels/${currentNovelId}/chapters/${chapterId}/diff?v1=${v1}&v2=${v2}`
      )
      setDiffResult(data)
      setSelectedV1(v1)
      setSelectedV2(v2)
    } catch {
      setDiffResult(null)
    } finally {
      setDiffLoading(false)
    }
  }

  const handleDiffWithCurrent = (v: number) => {
    handleDiff(v, 0)
  }

  const reasonLabels: Record<string, { label: string; color: string }> = {
    ai_write: { label: 'AI 写作', color: '#7c8aff' },
    manual: { label: '手动保存', color: '#10b981' },
    auto: { label: '自动保存', color: '#f59e0b' },
    review: { label: '审查后', color: '#ef4444' },
  }

  return (
    <NoNovelGuard>
    <div className="page history-page">
      <h1>章节版本历史</h1>
      <div className="help-box">
        <p>查看章节的修改历史，对比不同版本的差异。每次 AI 写作覆盖章节前会自动保存快照。</p>
      </div>

      <div className="history-input">
        <select
          value={chapterId}
          onChange={(e) => setChapterId(e.target.value)}
          className="chapter-select"
        >
          <option value="">选择章节...</option>
          {chapterList.map((ch) => (
            <option key={ch.chapter_id} value={ch.chapter_id}>
              {ch.chapter_id} - {ch.title}
            </option>
          ))}
        </select>
        <button onClick={loadVersions} disabled={loading || !chapterId.trim()}>
          {loading ? '加载中...' : '查看历史'}
        </button>
      </div>

      {versions.length > 0 && (
        <div className="history-content">
          <div className="version-list">
            <h2>版本列表 ({versions.length})</h2>
            {versions.map((v) => {
              const reasonInfo = reasonLabels[v.reason] || { label: v.reason, color: '#888' }
              return (
                <div key={v.version} className="version-item">
                  <div className="version-header">
                    <span className="version-num">v{v.version}</span>
                    <span className="version-reason" style={{ background: reasonInfo.color }}>
                      {reasonInfo.label}
                    </span>
                    <span className="version-time">{v.timestamp}</span>
                    <span className="version-chars">{v.char_count.toLocaleString()} 字</span>
                  </div>
                  <div className="version-actions">
                    {v.version > 1 && (
                      <button
                        className="diff-btn"
                        onClick={() => handleDiff(v.version - 1, v.version)}
                        disabled={diffLoading}
                      >
                        与上一版对比
                      </button>
                    )}
                    <button
                      className="diff-btn current"
                      onClick={() => handleDiffWithCurrent(v.version)}
                      disabled={diffLoading}
                    >
                      与当前对比
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {diffResult && (
            <div className="diff-panel">
              <div className="diff-header">
                <h2>
                  对比: v{diffResult.version_a} → {diffResult.version_b === 0 ? '当前' : `v${diffResult.version_b}`}
                </h2>
                <div className="diff-stats">
                  <span className="stat-add">+{diffResult.stats.added_lines} 行</span>
                  <span className="stat-del">-{diffResult.stats.removed_lines} 行</span>
                </div>
              </div>
              <div
                className="diff-content"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(diffResult.diff_html) }}
              />
            </div>
          )}
        </div>
      )}

      {versions.length === 0 && !loading && chapterId && (
        <p className="empty-hint">该章节暂无版本历史。</p>
      )}

      <style>{`
        .history-page { max-width: 1100px; }
        .history-input {
          display: flex; gap: 12px; margin: 16px 0;
        }
        .chapter-select {
          flex: 1; padding: 10px 16px; border: 2px solid #e0e0e0; border-radius: 8px;
          font-size: 14px; outline: none; background: #fff;
        }
        .chapter-select:focus { border-color: #7c8aff; }
        .history-input button {
          padding: 10px 20px; background: #7c8aff; color: #fff; border: none;
          border-radius: 8px; font-size: 14px; cursor: pointer;
        }
        .history-input button:hover { background: #5a6ae0; }
        .history-input button:disabled { background: #c5c9f0; cursor: not-allowed; }
        .history-content {
          display: grid; grid-template-columns: 340px 1fr; gap: 20px; margin-top: 16px;
        }
        .version-list {
          background: #fff; border: 1px solid #e0e0e0; border-radius: 12px;
          padding: 16px; max-height: 70vh; overflow-y: auto;
        }
        .version-list h2 { margin: 0 0 12px; font-size: 15px; }
        .version-item {
          border: 1px solid #f0f0f0; border-radius: 8px; padding: 10px 12px;
          margin-bottom: 8px;
        }
        .version-header {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .version-num {
          font-weight: 700; font-size: 14px; color: #333;
        }
        .version-reason {
          font-size: 11px; color: #fff; padding: 1px 6px; border-radius: 8px;
        }
        .version-time { font-size: 11px; color: #aaa; }
        .version-chars { font-size: 11px; color: #888; margin-left: auto; }
        .version-actions {
          display: flex; gap: 6px; margin-top: 6px;
        }
        .diff-btn {
          padding: 3px 8px; border: 1px solid #d0d0d0; background: #fff;
          border-radius: 4px; font-size: 11px; cursor: pointer;
        }
        .diff-btn:hover { background: #f5f5ff; border-color: #7c8aff; }
        .diff-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .diff-btn.current { border-color: #10b981; color: #059669; }
        .diff-panel {
          background: #fff; border: 1px solid #e0e0e0; border-radius: 12px;
          padding: 16px; max-height: 70vh; overflow-y: auto;
        }
        .diff-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 12px;
        }
        .diff-header h2 { margin: 0; font-size: 15px; }
        .diff-stats { display: flex; gap: 12px; font-size: 13px; }
        .stat-add { color: #10b981; }
        .stat-del { color: #ef4444; }
        .diff-content { font-size: 13px; overflow-x: auto; }
        .diff-table {
          width: 100%; border-collapse: collapse; font-family: monospace;
        }
        .diff-table th {
          background: #f5f5f5; padding: 6px 8px; text-align: left;
          border-bottom: 2px solid #e0e0e0; font-size: 12px;
        }
        .diff-table td {
          padding: 2px 8px; border-bottom: 1px solid #f0f0f0;
          white-space: pre-wrap; word-break: break-all;
        }
        .diff-table .ln { width: 40px; color: #aaa; font-size: 11px; text-align: right; }
        .diff-eq td:last-child { color: #666; }
        .diff-add { background: #d1fae5; }
        .diff-add td:last-child { color: #065f46; }
        .diff-del { background: #fee2e2; }
        .diff-del td:last-child { color: #991b1b; }
        .empty-hint { color: #aaa; text-align: center; padding: 30px; }
      `}</style>
    </div>
    </NoNovelGuard>
  )
}
