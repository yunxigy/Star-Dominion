import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'
import NoNovelGuard from '../components/NoNovelGuard'

interface ExportChapter {
  chapter_id: string
  title: string
  word_count: number
}

export default function ExportPage() {
  const { currentNovelId } = useNovelStore()
  const [chapters, setChapters] = useState<ExportChapter[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/export/chapters`)
      .then(({ data }) => {
        setChapters(data.chapters || [])
        // Select all by default
        setSelected(new Set((data.chapters || []).map((c: ExportChapter) => c.chapter_id)))
      })
      .catch(() => setChapters([]))
      .finally(() => setLoading(false))
  }, [currentNovelId])

  const toggleChapter = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === chapters.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(chapters.map((c) => c.chapter_id)))
    }
  }

  const handleExport = async (format: 'epub' | 'pdf') => {
    if (!currentNovelId || selected.size === 0) return
    setExporting(format)
    try {
      const chapterParam = Array.from(selected).join(',')
      const url = `/api/novels/${currentNovelId}/export/${format}?chapters=${encodeURIComponent(chapterParam)}`
      // Direct download via anchor
      const a = document.createElement('a')
      a.href = url
      a.download = `${currentNovelId}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '导出失败'
      alert(msg)
    } finally {
      setTimeout(() => setExporting(null), 2000)
    }
  }

  const totalWords = chapters
    .filter((c) => selected.has(c.chapter_id))
    .reduce((sum, c) => sum + c.word_count, 0)

  return (
    <NoNovelGuard>
    <div className="page export-page">
      <h1>导出小说</h1>
      <div className="help-box">
        <p>选择要导出的章节，然后选择格式（EPUB 或 PDF）进行下载。EPUB 适合电子书阅读器，PDF 适合打印或分享。</p>
      </div>

      {loading && <p>加载中...</p>}

      <div className="export-summary">
        <span>已选 {selected.size} / {chapters.length} 章</span>
        <span>总字数: {totalWords.toLocaleString()}</span>
      </div>

      <div className="export-actions">
        <button
          className="export-btn epub-btn"
          onClick={() => handleExport('epub')}
          disabled={selected.size === 0 || exporting !== null}
        >
          {exporting === 'epub' ? '生成中...' : '📚 导出 EPUB'}
        </button>
        <button
          className="export-btn pdf-btn"
          onClick={() => handleExport('pdf')}
          disabled={selected.size === 0 || exporting !== null}
        >
          {exporting === 'pdf' ? '生成中...' : '📄 导出 PDF'}
        </button>
      </div>

      <div className="chapter-select-header">
        <button className="select-all-btn" onClick={toggleAll}>
          {selected.size === chapters.length ? '取消全选' : '全选'}
        </button>
      </div>

      <div className="export-chapter-list">
        {chapters.map((ch) => (
          <label
            key={ch.chapter_id}
            className={`export-chapter-item ${selected.has(ch.chapter_id) ? 'selected' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.has(ch.chapter_id)}
              onChange={() => toggleChapter(ch.chapter_id)}
            />
            <span className="ch-id">{ch.chapter_id}</span>
            <span className="ch-title">{ch.title}</span>
            <span className="ch-words">{ch.word_count.toLocaleString()} 字</span>
          </label>
        ))}
        {chapters.length === 0 && !loading && <p className="empty-hint">暂无可导出的章节。</p>}
      </div>

      <style>{`
        .export-page { max-width: 800px; }
        .export-summary {
          display: flex; gap: 24px; padding: 12px 16px;
          background: #f0f4ff; border-radius: 8px; margin: 16px 0;
          font-size: 14px; color: #445;
        }
        .export-actions {
          display: flex; gap: 12px; margin: 16px 0;
        }
        .export-btn {
          padding: 10px 24px; border: none; border-radius: 8px;
          font-size: 15px; font-weight: 600; cursor: pointer;
          transition: all 0.15s;
        }
        .epub-btn { background: #7c8aff; color: #fff; }
        .epub-btn:hover { background: #5a6ae0; }
        .epub-btn:disabled { background: #c5c9f0; cursor: not-allowed; }
        .pdf-btn { background: #10b981; color: #fff; }
        .pdf-btn:hover { background: #059669; }
        .pdf-btn:disabled { background: #a7f3d0; cursor: not-allowed; }
        .chapter-select-header {
          margin: 12px 0 8px;
        }
        .select-all-btn {
          padding: 4px 12px; border: 1px solid #d0d0d0; background: #fff;
          border-radius: 4px; font-size: 13px; cursor: pointer;
        }
        .select-all-btn:hover { background: #f5f5f5; }
        .export-chapter-list {
          background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
          max-height: 50vh; overflow-y: auto;
        }
        .export-chapter-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0;
          transition: background 0.1s;
        }
        .export-chapter-item:hover { background: #f5f5ff; }
        .export-chapter-item.selected { background: #eef0ff; }
        .export-chapter-item input[type="checkbox"] { accent-color: #7c8aff; }
        .ch-id { font-size: 12px; color: #888; min-width: 60px; }
        .ch-title { flex: 1; font-size: 14px; }
        .ch-words { font-size: 12px; color: #aaa; min-width: 70px; text-align: right; }
        .empty-hint { color: #aaa; text-align: center; padding: 20px; }
      `}</style>
    </div>
    </NoNovelGuard>
  )
}
