import { useState, useEffect } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'
import NoNovelGuard from '../components/NoNovelGuard'

interface Source {
  source_id: string
  has_style: boolean
  has_setting: boolean
  preview?: string
}

export default function ToolsPage() {
  const { currentNovelId } = useNovelStore()
  const [tab, setTab] = useState<'validate' | 'source' | 'radar' | 'init'>('validate')

  return (
    <div className="page tools-page">
      <h1>工具箱</h1>
      <div className="help-box">
        <p>高级工具集：验证、来源管理、市场分析、创建小说。</p>
      </div>

      <div className="tools-tabs">
        {[
          { key: 'validate', label: '🔍 验证', icon: '' },
          { key: 'source', label: '📦 来源管理', icon: '' },
          { key: 'radar', label: '📡 市场分析', icon: '' },
          { key: 'init', label: '🆕 创建小说', icon: '' },
        ].map((t) => (
          <button
            key={t.key}
            className={`tools-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key as typeof tab)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'validate' && <ValidatePanel />}
      {tab === 'source' && <SourcePanel />}
      {tab === 'radar' && <RadarPanel />}
      {tab === 'init' && <InitPanel />}

      <style>{`
        .tools-page { max-width: 900px; }
        .tools-tabs {
          display: flex; gap: 8px; margin: 16px 0; flex-wrap: wrap;
        }
        .tools-tab {
          padding: 8px 16px; border: 1px solid #d0d0d0; background: #fff;
          border-radius: 8px; font-size: 13px; cursor: pointer;
          transition: all 0.1s;
        }
        .tools-tab.active {
          background: #7c8aff; color: #fff; border-color: #7c8aff;
        }
        .tools-tab:hover:not(.active) { background: #f5f5ff; }
        .tools-panel {
          background: #fff; border: 1px solid #e0e0e0; border-radius: 12px;
          padding: 20px; margin-top: 12px;
        }
        .tools-panel h2 { margin: 0 0 16px; font-size: 16px; }
        .tools-row { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
        .tools-row input, .tools-row select {
          flex: 1; padding: 8px 12px; border: 1px solid #d0d0d0; border-radius: 6px;
          font-size: 14px;
        }
        .tools-btn {
          padding: 8px 16px; background: #7c8aff; color: #fff; border: none;
          border-radius: 6px; font-size: 13px; cursor: pointer;
        }
        .tools-btn:hover { background: #5a6ae0; }
        .tools-btn:disabled { background: #c5c9f0; cursor: not-allowed; }
        .tools-btn.green { background: #10b981; }
        .tools-btn.green:hover { background: #059669; }
        .tools-result {
          margin-top: 16px; padding: 12px; background: #f8f9fa; border-radius: 8px;
          font-size: 13px; line-height: 1.6; white-space: pre-wrap;
        }
        .tools-result.error { background: #fef2f2; color: #991b1b; }
        .tools-result.success { background: #f0fdf4; color: #166534; }
        .source-item {
          padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px;
          margin-bottom: 8px; display: flex; justify-content: space-between;
          align-items: center;
        }
        .source-name { font-weight: 600; }
        .source-meta { font-size: 12px; color: #888; }
        .validate-item {
          padding: 10px; border-bottom: 1px solid #f0f0f0;
          display: flex; gap: 8px; align-items: center;
        }
        .validate-item:last-child { border-bottom: none; }
        .check-icon { font-size: 16px; }
      `}</style>
    </div>
  )
}

function ValidatePanel() {
  const { currentNovelId } = useNovelStore()
  const [chapterId, setChapterId] = useState('latest')
  const [truthResult, setTruthResult] = useState<Record<string, unknown> | null>(null)
  const [postResult, setPostResult] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  const runTruth = async () => {
    if (!currentNovelId) return
    setLoading(true)
    try {
      const { data } = await api.post(`/novels/${currentNovelId}/validate/truth?chapter_id=${chapterId}`)
      setTruthResult(data)
    } catch { setTruthResult({ error: '验证失败' }) }
    finally { setLoading(false) }
  }

  const runPostWrite = async () => {
    if (!currentNovelId) return
    setLoading(true)
    try {
      const { data } = await api.post(`/novels/${currentNovelId}/validate/post-write?chapter_id=${chapterId}`)
      setPostResult(data)
    } catch { setPostResult({ error: '验证失败' }) }
    finally { setLoading(false) }
  }

  return (
    <NoNovelGuard>
    <div className="tools-panel">
      <h2>验证工具</h2>
      <div className="tools-row">
        <input value={chapterId} onChange={(e) => setChapterId(e.target.value)} placeholder="章节 ID (latest)" />
        <button className="tools-btn" onClick={runTruth} disabled={loading}>真相验证</button>
        <button className="tools-btn green" onClick={runPostWrite} disabled={loading}>写后验证</button>
      </div>

      {truthResult && (
        <div className={`tools-result ${truthResult.error ? 'error' : ''}`}>
          <strong>真相验证：</strong>
          {truthResult.error
            ? String(truthResult.error)
            : JSON.stringify(truthResult, null, 2)
          }
        </div>
      )}

      {postResult && (
        <div className={`tools-result ${postResult.error ? 'error' : ''}`}>
          <strong>写后验证：</strong>
          {postResult.error
            ? String(postResult.error)
            : JSON.stringify(postResult, null, 2)
          }
        </div>
      )}
    </div>
    </NoNovelGuard>
  )
}

function SourcePanel() {
  const { currentNovelId } = useNovelStore()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/sources`)
      .then(({ data }) => setSources(data.sources || []))
      .catch(() => setSources([]))
      .finally(() => setLoading(false))
  }, [currentNovelId])

  const handlePromote = async (sourceId: string) => {
    if (!currentNovelId) return
    if (!confirm(`确定将「${sourceId}」晋升为当前风格？`)) return
    try {
      await api.post(`/novels/${currentNovelId}/sources/${sourceId}/promote`)
      alert('晋升成功')
    } catch (e: unknown) {
      alert(`晋升失败: ${(e as Error).message}`)
    }
  }

  return (
    <NoNovelGuard>
    <div className="tools-panel">
      <h2>来源管理（Source Pack）</h2>
      {loading && <p>加载中...</p>}
      {sources.length === 0 && !loading && <p className="empty-hint">暂无来源数据。通过 CLI 的 <code>openwrite style extract</code> 或对话让 AI 提取。</p>}
      {sources.map((s) => (
        <div key={s.source_id} className="source-item">
          <div>
            <div className="source-name">{s.source_id}</div>
            <div className="source-meta">
              {s.has_style && '🎨 风格 '}
              {s.has_setting && '📋 设定 '}
              {s.preview && `— ${s.preview.slice(0, 60)}...`}
            </div>
          </div>
          <button className="tools-btn green" onClick={() => handlePromote(s.source_id)}>
            晋升为风格
          </button>
        </div>
      ))}
    </div>
    </NoNovelGuard>
  )
}

function RadarPanel() {
  const { currentNovelId } = useNovelStore()
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRun = async () => {
    if (!currentNovelId) return
    setLoading(true)
    setResult('')
    try {
      const { data } = await api.post(`/novels/${currentNovelId}/radar`, { query, genre })
      setResult(data.analysis || JSON.stringify(data, null, 2))
    } catch (e: unknown) {
      setResult(`分析失败: ${(e as Error).message}`)
    } finally { setLoading(false) }
  }

  return (
    <NoNovelGuard>
    <div className="tools-panel">
      <h2>市场趋势分析</h2>
      <div className="tools-row">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="分析主题（留空使用默认）" />
      </div>
      <div className="tools-row">
        <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="类型/题材（可选）" />
        <button className="tools-btn" onClick={handleRun} disabled={loading}>
          {loading ? '分析中...' : '开始分析'}
        </button>
      </div>
      {result && <div className="tools-result">{result}</div>}
    </div>
    </NoNovelGuard>
  )
}

function InitPanel() {
  const [novelId, setNovelId] = useState('')
  const [title, setTitle] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)

  const handleInit = async () => {
    if (!novelId.trim()) return
    setLoading(true)
    setResult('')
    try {
      const { data } = await api.post('/novels/init', { novel_id: novelId, title: title || novelId })
      setResult(`✅ 创建成功: ${data.novel_id}\n路径: ${data.path}`)
    } catch (e: unknown) {
      setResult(`❌ 创建失败: ${(e as Error).message}`)
    } finally { setLoading(false) }
  }

  return (
    <div className="tools-panel">
      <h2>创建新小说</h2>
      <div className="tools-row">
        <input value={novelId} onChange={(e) => setNovelId(e.target.value)} placeholder="小说 ID (英文，如 my_novel)" />
      </div>
      <div className="tools-row">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="小说标题（可选）" />
        <button className="tools-btn green" onClick={handleInit} disabled={loading || !novelId.trim()}>
          {loading ? '创建中...' : '创建小说'}
        </button>
      </div>
      {result && <div className={`tools-result ${result.startsWith('❌') ? 'error' : 'success'}`}>{result}</div>}
    </div>
  )
}
