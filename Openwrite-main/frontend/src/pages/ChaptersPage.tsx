import { useEffect, useState, lazy, Suspense } from 'react'
import { useNovelStore } from '../store/novelStore'
import { listChapters, getChapter } from '../api/chapters'
import api from '../api/client'
import type { ChapterInfo, ChapterContent } from '../types/chapter'
import NoNovelGuard from '../components/NoNovelGuard'

const OutlinePage = lazy(() => import('./OutlinePage'))
const HistoryPage = lazy(() => import('./HistoryPage'))

interface ReviewIssue {
  description: string
  severity: string
}

interface ReviewResult {
  passed: boolean
  score?: number
  issues?: (string | ReviewIssue)[]
}

type SubTab = 'chapters' | 'outline' | 'history'

export default function ChaptersPage() {
  const { currentNovelId } = useNovelStore()
  const [subTab, setSubTab] = useState<SubTab>('chapters')
  const [chapters, setChapters] = useState<ChapterInfo[]>([])
  const [selected, setSelected] = useState<ChapterContent | null>(null)
  const [loading, setLoading] = useState(false)

  // Write dialog state
  const [showWriteDialog, setShowWriteDialog] = useState(false)
  const [writeChapterId, setWriteChapterId] = useState('')
  const [writeGuidance, setWriteGuidance] = useState('')
  const [writeLoading, setWriteLoading] = useState(false)
  const [writeResult, setWriteResult] = useState<{
    ok: boolean
    word_count?: number
    review?: { ok?: boolean; passed?: boolean; score?: number; issues?: (string | { description: string; severity: string })[] }
  } | null>(null)

  // Review state
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null)

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    listChapters(currentNovelId)
      .then(setChapters)
      .catch(() => setChapters([]))
      .finally(() => setLoading(false))
  }, [currentNovelId])

  const handleSelect = async (ch: ChapterInfo) => {
    if (!currentNovelId) return
    try {
      const content = await getChapter(currentNovelId, ch.chapter_id)
      setSelected(content)
      setReviewResult(null)
    } catch {
      setSelected(null)
    }
  }

  const handleDelete = async (chapterId: string) => {
    if (!currentNovelId) return
    if (!confirm(`确定删除章节「${chapterId}」？文件会移到回收站。`)) return
    try {
      await api.delete(`/novels/${currentNovelId}/chapters/${chapterId}`)
      if (selected?.chapter_id === chapterId) setSelected(null)
      listChapters(currentNovelId).then(setChapters)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '删除失败'
      alert(msg)
    }
  }

  const handleWrite = async () => {
    if (!currentNovelId || !writeChapterId.trim()) return
    setWriteLoading(true)
    setWriteResult(null)
    try {
      const { data } = await api.post(`/novels/${currentNovelId}/chapters/${encodeURIComponent(writeChapterId)}/write`, {
        guidance: writeGuidance || undefined,
      })
      setWriteResult(data)
      // Refresh chapter list
      listChapters(currentNovelId).then(setChapters)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '写作失败'
      alert(msg)
    } finally {
      setWriteLoading(false)
    }
  }

  const handleReview = async () => {
    if (!currentNovelId || !selected) return
    setReviewLoading(true)
    setReviewResult(null)
    try {
      const { data } = await api.post(`/novels/${currentNovelId}/chapters/${encodeURIComponent(selected.chapter_id)}/review`)
      setReviewResult(data)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '审查失败'
      alert(msg)
    } finally {
      setReviewLoading(false)
    }
  }

  return (
    <NoNovelGuard>
    <div className="page chapters-page">
      <div className="sub-tab-bar">
        {([
          { key: 'chapters', label: '📖 章节', icon: '' },
          { key: 'outline', label: '📋 大纲', icon: '' },
          { key: 'history', label: '🕐 版本历史', icon: '' },
        ] as { key: SubTab; label: string; icon: string }[]).map((tab) => (
          <button
            key={tab.key}
            className={`sub-tab ${subTab === tab.key ? 'active' : ''}`}
            onClick={() => setSubTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'outline' && (
        <Suspense fallback={<p>加载中...</p>}>
          <OutlinePage />
        </Suspense>
      )}

      {subTab === 'history' && (
        <Suspense fallback={<p>加载中...</p>}>
          <HistoryPage />
        </Suspense>
      )}

      {subTab === 'chapters' && (
      <>
      <div className="help-box">
        <p>查看和管理已写章节。左侧列表点击章节可预览正文内容。点击"写新章节"按钮可以生成新章节，点击"审查"按钮可以对当前章节进行质量检查。</p>
      </div>
      {loading && <p>加载中...</p>}

      <div className="chapters-layout">
        <div className="chapter-list">
          <div className="chapter-list-header">
            <span>章节列表 ({chapters.length})</span>
            <button
              className="write-btn"
              onClick={() => setShowWriteDialog(true)}
            >
              写新章节
            </button>
          </div>
          {chapters.map((ch) => (
            <div
              key={ch.chapter_id}
              className={`chapter-item ${selected?.chapter_id === ch.chapter_id ? 'active' : ''}`}
              onClick={() => handleSelect(ch)}
            >
              <div className="chapter-item-main">
                <span className="chapter-id">{ch.chapter_id}</span>
                <span className="chapter-title">{ch.title || '(无标题)'}</span>
              </div>
              <button
                className="chapter-delete-btn"
                title="删除章节"
                onClick={(e) => { e.stopPropagation(); handleDelete(ch.chapter_id) }}
              >
                ✕
              </button>
            </div>
          ))}
          {chapters.length === 0 && !loading && <p className="empty-hint">暂无章节。</p>}
        </div>

        <div className="chapter-detail">
          {selected ? (
            <>
              <div className="chapter-detail-header">
                <div>
                  <h2>{selected.title || selected.chapter_id}</h2>
                  <p className="chapter-meta">字数: {selected.word_count}</p>
                </div>
                <button
                  className="review-btn"
                  onClick={handleReview}
                  disabled={reviewLoading}
                >
                  {reviewLoading ? '审查中...' : '审查章节'}
                </button>
              </div>

              {reviewResult && (
                <div className={`review-result ${reviewResult.passed ? 'passed' : 'failed'}`}>
                  <div className="review-header">
                    <span className="review-status">
                      {reviewResult.passed ? '✅ 审查通过' : '❌ 审查未通过'}
                    </span>
                    {reviewResult.score !== undefined && (
                      <span className="review-score">评分: {reviewResult.score}</span>
                    )}
                  </div>
                  {reviewResult.issues && reviewResult.issues.length > 0 && (
                    <div className="review-issues">
                      <h4>发现的问题：</h4>
                      <ul>
                        {reviewResult.issues.map((issue, idx) => (
                          <li key={idx}>
                            {typeof issue === 'string'
                              ? issue
                              : `${(issue as Record<string, string>).severity === 'critical' ? '🔴' : '🟡'} ${(issue as Record<string, string>).description || JSON.stringify(issue)}`
                            }
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <pre className="chapter-content">{selected.content}</pre>
            </>
          ) : (
            <p className="empty-hint">点击左侧章节查看内容。</p>
          )}
        </div>
      </div>

      {/* Write Dialog */}
      {showWriteDialog && (
        <div className="dialog-overlay" onClick={() => setShowWriteDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>写新章节</h3>
            <div className="dialog-field">
              <label>章节 ID</label>
              <input
                type="text"
                value={writeChapterId}
                onChange={(e) => setWriteChapterId(e.target.value)}
                placeholder="例如: ch_001"
              />
            </div>
            <div className="dialog-field">
              <label>写作指导（可选）</label>
              <textarea
                value={writeGuidance}
                onChange={(e) => setWriteGuidance(e.target.value)}
                placeholder="输入任何想要特别强调的写作要求..."
                rows={4}
              />
            </div>

            {writeResult && (
              <div className="write-result">
                <p>✅ 写作完成！字数: {writeResult.word_count}</p>
                {writeResult.review?.ok && (
                  <div className="write-review">
                    <p>
                      {writeResult.review.passed ? '✅ 自动审查通过' : '⚠️ 自动审查未通过'}
                      {writeResult.review.score !== undefined && ` — 评分: ${writeResult.review.score}`}
                    </p>
                    {writeResult.review.issues && writeResult.review.issues.length > 0 && (
                      <ul>
                        {writeResult.review.issues.slice(0, 3).map((issue, idx) => (
                          <li key={idx}>
                            {typeof issue === 'string'
                              ? issue
                              : `${(issue as { severity: string }).severity === 'critical' ? '🔴' : '🟡'} ${(issue as { description: string }).description}`
                            }
                          </li>
                        ))}
                        {writeResult.review.issues.length > 3 && (
                          <li>...还有 {writeResult.review.issues.length - 3} 条问题</li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="dialog-actions">
              <button
                className="dialog-cancel"
                onClick={() => {
                  setShowWriteDialog(false)
                  setWriteResult(null)
                }}
              >
                取消
              </button>
              <button
                className="dialog-confirm"
                onClick={handleWrite}
                disabled={writeLoading || !writeChapterId.trim()}
              >
                {writeLoading ? '写作中...' : '开始写作'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .chapters-layout {
          display: flex;
          gap: 24px;
          margin-top: 16px;
          height: calc(100vh - 260px);
        }
        .chapter-list {
          width: 280px;
          min-width: 280px;
          overflow-y: auto;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
        }
        .chapter-list-header {
          padding: 10px 12px;
          font-weight: 600;
          font-size: 13px;
          color: #666;
          border-bottom: 1px solid #e0e0e0;
          background: #fafafa;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .write-btn {
          padding: 4px 10px;
          background: #7c8aff;
          color: #fff;
          border: none;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .write-btn:hover { background: #5a6ae0; }
        .chapter-item {
          padding: 10px 12px;
          cursor: pointer;
          border-bottom: 1px solid #f0f0f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .chapter-item:hover { background: #f5f5ff; }
        .chapter-item.active { background: #e8eaff; border-left: 3px solid #7c8aff; }
        .chapter-item-main {
          display: flex; flex-direction: column; gap: 2px; flex: 1;
        }
        .chapter-delete-btn {
          background: none; border: none; cursor: pointer; color: #ccc;
          font-size: 14px; padding: 2px 6px; border-radius: 4px; line-height: 1;
        }
        .chapter-delete-btn:hover { color: #ef4444; background: #fef2f2; }
        .chapter-id { font-size: 12px; color: #888; }
        .chapter-title { font-size: 14px; }
        .chapter-detail {
          flex: 1;
          overflow-y: auto;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 20px;
        }
        .chapter-detail-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
        }
        .chapter-detail-header h2 {
          margin: 0 0 4px;
        }
        .chapter-meta { font-size: 13px; color: #888; margin: 0; }
        .review-btn {
          padding: 6px 14px;
          background: #10b981;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .review-btn:hover { background: #059669; }
        .review-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .review-result {
          padding: 12px;
          border-radius: 6px;
          margin-bottom: 16px;
        }
        .review-result.passed {
          background: #d1fae5;
          border: 1px solid #10b981;
        }
        .review-result.failed {
          background: #fee2e2;
          border: 1px solid #ef4444;
        }
        .review-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .review-status {
          font-weight: 600;
          font-size: 14px;
        }
        .review-score {
          font-size: 13px;
          color: #666;
        }
        .review-issues h4 {
          margin: 0 0 6px;
          font-size: 13px;
          color: #666;
        }
        .review-issues ul {
          margin: 0;
          padding-left: 20px;
          font-size: 13px;
        }
        .review-issues li {
          margin: 4px 0;
          color: #333;
        }
        .chapter-content {
          white-space: pre-wrap;
          word-break: break-word;
          font-family: inherit;
          font-size: 14px;
          line-height: 1.8;
          margin-top: 12px;
        }
        .empty-hint { color: #aaa; text-align: center; padding: 20px; }

        /* Dialog */
        .dialog-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .dialog {
          background: #fff;
          border-radius: 12px;
          padding: 24px;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        }
        .dialog h3 {
          margin: 0 0 20px;
          font-size: 18px;
        }
        .dialog-field {
          margin-bottom: 16px;
        }
        .dialog-field label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: #666;
          margin-bottom: 6px;
        }
        .dialog-field input, .dialog-field textarea {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d0d0d0;
          border-radius: 6px;
          font-size: 14px;
          font-family: inherit;
          box-sizing: border-box;
        }
        .dialog-field input:focus, .dialog-field textarea:focus {
          outline: none;
          border-color: #7c8aff;
          box-shadow: 0 0 0 2px rgba(124,138,255,0.15);
        }
        .dialog-field textarea {
          resize: vertical;
        }
        .write-result {
          padding: 10px;
          background: #d1fae5;
          border-radius: 6px;
          margin-bottom: 16px;
        }
        .write-result p {
          margin: 0;
          font-size: 14px;
          color: #065f46;
        }
        .write-review {
          margin-top: 8px; padding-top: 8px; border-top: 1px solid #a7f3d0;
        }
        .write-review p { margin: 0 0 4px; font-size: 13px; }
        .write-review ul { margin: 4px 0 0; padding-left: 18px; font-size: 12px; color: #555; }
        .write-review li { margin: 2px 0; }
        .dialog-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }
        .dialog-cancel {
          padding: 8px 16px;
          border: 1px solid #d0d0d0;
          background: #fff;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
        }
        .dialog-cancel:hover { background: #f5f5f5; }
        .dialog-confirm {
          padding: 8px 16px;
          background: #7c8aff;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .dialog-confirm:hover { background: #5a6ae0; }
        .dialog-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
        .sub-tab-bar {
          display: flex; gap: 4px; padding: 8px 0; margin-bottom: 12px;
        }
        .sub-tab {
          padding: 6px 14px; border: none; background: none;
          border-radius: 6px; font-size: 13px; cursor: pointer;
          color: #666; transition: all 0.1s;
        }
        .sub-tab:hover { background: #f0f0f0; }
        .sub-tab.active { background: #7c8aff; color: #fff; }
      `}</style>
      </>
      )}
    </div>
    </NoNovelGuard>
  )
}
