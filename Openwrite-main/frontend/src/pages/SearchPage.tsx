import { useState, useCallback } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'
import NoNovelGuard from '../components/NoNovelGuard'

interface SearchResult {
  type: string
  id: string
  title: string
  file: string
  match_text: string
  line_number: number
  context: string
}

interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
}

const typeLabels: Record<string, { label: string; color: string; icon: string }> = {
  chapter: { label: '章节', color: '#7c8aff', icon: '📖' },
  character: { label: '角色', color: '#f59e0b', icon: '👤' },
  outline: { label: '大纲', color: '#10b981', icon: '📋' },
  truth: { label: '真相', color: '#ef4444', icon: '📄' },
}

export default function SearchPage() {
  const { currentNovelId } = useNovelStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    chapters: true,
    characters: true,
    outline: true,
    truth: true,
  })

  const handleSearch = useCallback(async () => {
    if (!currentNovelId || !query.trim()) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query.trim() })
      if (!filters.chapters) params.set('chapters', 'false')
      if (!filters.characters) params.set('characters', 'false')
      if (!filters.outline) params.set('outline', 'false')
      if (!filters.truth) params.set('truth', 'false')

      const { data } = await api.get(`/novels/${currentNovelId}/search?${params}`)
      setResults(data)
    } catch {
      setResults(null)
    } finally {
      setLoading(false)
    }
  }, [currentNovelId, query, filters])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const toggleFilter = (key: keyof typeof filters) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const highlightMatch = (text: string, q: string) => {
    if (!q) return text
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    )
  }

  return (
    <NoNovelGuard>
    <div className="page search-page">
      <h1>全局搜索</h1>

      <div className="search-bar">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索章节、角色、大纲、真相文件..."
          className="search-input"
        />
        <button
          className="search-btn"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? '搜索中...' : '🔍 搜索'}
        </button>
      </div>

      <div className="search-filters">
        {Object.entries(filters).map(([key, enabled]) => (
          <button
            key={key}
            className={`filter-chip ${enabled ? 'active' : ''}`}
            onClick={() => toggleFilter(key as keyof typeof filters)}
          >
            {key === 'chapters' && '📖 章节'}
            {key === 'characters' && '👤 角色'}
            {key === 'outline' && '📋 大纲'}
            {key === 'truth' && '📄 真相'}
          </button>
        ))}
      </div>

      {results && (
        <div className="search-results-info">
          找到 <strong>{results.total}</strong> 条结果
        </div>
      )}

      <div className="search-results">
        {results?.results.map((r, idx) => {
          const typeInfo = typeLabels[r.type] || { label: r.type, color: '#888', icon: '📄' }
          return (
            <div key={`${r.type}-${r.id}-${idx}`} className="search-result-item">
              <div className="result-header">
                <span className="result-type" style={{ background: typeInfo.color }}>
                  {typeInfo.icon} {typeInfo.label}
                </span>
                <span className="result-title">{r.title}</span>
                <span className="result-file">{r.file}</span>
                {r.line_number > 0 && <span className="result-line">行 {r.line_number}</span>}
              </div>
              <div className="result-context">
                {highlightMatch(r.context, query)}
              </div>
            </div>
          )
        })}
        {results && results.results.length === 0 && !loading && (
          <p className="empty-hint">未找到匹配内容。</p>
        )}
      </div>

      <style>{`
        .search-page { max-width: 900px; }
        .search-bar {
          display: flex; gap: 12px; margin: 16px 0;
        }
        .search-input {
          flex: 1; padding: 10px 16px; border: 2px solid #e0e0e0; border-radius: 8px;
          font-size: 15px; outline: none; transition: border-color 0.15s;
        }
        .search-input:focus { border-color: #7c8aff; }
        .search-btn {
          padding: 10px 20px; background: #7c8aff; color: #fff; border: none;
          border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
          transition: background 0.15s;
        }
        .search-btn:hover { background: #5a6ae0; }
        .search-btn:disabled { background: #c5c9f0; cursor: not-allowed; }
        .search-filters {
          display: flex; gap: 8px; margin-bottom: 16px;
        }
        .filter-chip {
          padding: 4px 12px; border: 1px solid #d0d0d0; background: #fff;
          border-radius: 20px; font-size: 13px; cursor: pointer;
          transition: all 0.1s;
        }
        .filter-chip.active {
          background: #eef0ff; border-color: #7c8aff; color: #5a6ae0;
        }
        .filter-chip:hover { background: #f5f5ff; }
        .search-results-info {
          font-size: 13px; color: #888; margin-bottom: 12px;
        }
        .search-results {
          display: flex; flex-direction: column; gap: 8px;
        }
        .search-result-item {
          background: #fff; border: 1px solid #e0e0e0; border-radius: 8px;
          padding: 12px 16px; transition: box-shadow 0.15s;
        }
        .search-result-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .result-header {
          display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
        }
        .result-type {
          font-size: 11px; color: #fff; padding: 2px 8px; border-radius: 10px;
          font-weight: 600; white-space: nowrap;
        }
        .result-title { font-weight: 600; font-size: 14px; }
        .result-file { font-size: 11px; color: #aaa; margin-left: auto; }
        .result-line { font-size: 11px; color: #aaa; }
        .result-context {
          font-size: 13px; color: #555; line-height: 1.6;
          padding: 6px 10px; background: #fafafa; border-radius: 4px;
        }
        .search-highlight {
          background: #fef08a; color: #92400e; padding: 0 2px; border-radius: 2px;
        }
        .empty-hint { color: #aaa; text-align: center; padding: 30px; }
      `}</style>
    </div>
    </NoNovelGuard>
  )
}
