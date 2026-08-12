import { useState, useRef, useEffect, useCallback } from 'react'
import { useNovelStore } from '../store/novelStore'

interface AutoWriteConfig {
  max_retries: number
  score_threshold: number
  target_words: number
  guidance: string
  start_chapter: string
  max_chapters: number
  auto_outline: boolean
  outline_batch: number
  continue_on_review_error: boolean
}

interface ChapterResult {
  chapter_id: string
  score: number
  passed: boolean
  retries: number
  word_count: number
  error: string
}

interface LogEntry {
  id: number
  time: string
  text: string
  type: 'info' | 'success' | 'warning' | 'error' | 'tool'
}

type WsStatus = 'disconnected' | 'connecting' | 'running' | 'paused' | 'done'

const DEFAULT_CONFIG: AutoWriteConfig = {
  max_retries: 3,
  score_threshold: 70,
  target_words: 3000,
  guidance: '',
  start_chapter: '',
  max_chapters: 0,
  auto_outline: true,
  outline_batch: 5,
  continue_on_review_error: false,
}

const STORAGE_KEYS = {
  config: 'autowrite_config',
  logs: 'autowrite_logs',
  results: 'autowrite_results',
  progress: 'autowrite_progress',
} as const

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export default function AutoWritePage() {
  const { currentNovelId } = useNovelStore()
  const [config, setConfig] = useState<AutoWriteConfig>(() => loadFromStorage(STORAGE_KEYS.config, DEFAULT_CONFIG))
  const [status, setStatus] = useState<WsStatus>('disconnected')
  const [logs, setLogs] = useState<LogEntry[]>(() => loadFromStorage(STORAGE_KEYS.logs, []))
  const [results, setResults] = useState<ChapterResult[]>(() => loadFromStorage(STORAGE_KEYS.results, []))
  const [currentChapter, setCurrentChapter] = useState('')
  const [currentPhase, setCurrentPhase] = useState('')
  const [totalChapters, setTotalChapters] = useState(() => loadFromStorage(STORAGE_KEYS.progress, { total: 0 }).total)
  const [completedCount, setCompletedCount] = useState(() => loadFromStorage(STORAGE_KEYS.progress, { completed: 0 }).completed)
  const [showConfig, setShowConfig] = useState(true)

  const wsRef = useRef<WebSocket | null>(null)
  const handleMessageRef = useRef<(msg: Record<string, unknown>) => void>(() => undefined)
  const logIdRef = useRef(logs.length > 0 ? Math.max(...logs.map(l => l.id)) : 0)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'info') => {
    const id = ++logIdRef.current
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setLogs(prev => [...prev, { id, time, text, type }])
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(config))
  }, [config])

  useEffect(() => {
    const trimmed = logs.length > 500 ? logs.slice(-500) : logs
    localStorage.setItem(STORAGE_KEYS.logs, JSON.stringify(trimmed))
  }, [logs])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.results, JSON.stringify(results))
  }, [results])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify({ total: totalChapters, completed: completedCount }))
  }, [totalChapters, completedCount])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (!currentNovelId) {
      addLog('请先选择一本小说', 'error')
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws/auto-write?novel_id=${encodeURIComponent(currentNovelId)}`

    setStatus('connecting')
    addLog('正在连接服务器...', 'info')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      addLog('已连接，发送启动指令', 'success')
      setStatus('running')
      ws.send(JSON.stringify({ type: 'start', config }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        handleMessageRef.current(msg)
      } catch {
        addLog(`收到无法解析的消息: ${event.data}`, 'error')
      }
    }

    ws.onclose = () => {
      if (status !== 'done') {
        addLog('连接已断开', 'warning')
        setStatus('disconnected')
      }
    }

    ws.onerror = () => {
      addLog('WebSocket 连接错误', 'error')
    }
  }, [config, status, addLog, currentNovelId])

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    switch (msg.type) {
      case 'started':
        setTotalChapters((msg.total as number) || 0)
        setResults([])
        setCompletedCount(0)
        addLog(`自动写作已启动，共 ${(msg.total as number) || 0} 章待写`, 'info')
        break

      case 'chapter_start':
        setCurrentChapter(msg.chapter as string)
        setCurrentPhase('准备中')
        addLog(`── 开始写作第 ${(msg.index as number) + 1}/${msg.total} 章: ${msg.chapter}`, 'info')
        break

      case 'phase':
        setCurrentPhase(msg.phase === 'writing' ? '写作中' : '审查中')
        addLog(`  [${msg.chapter}] ${msg.phase === 'writing' ? '写作' : '审查'}（第 ${(msg.attempt as number) + 1} 次）`, 'tool')
        break

      case 'tool_call':
        addLog(`  调用工具: ${msg.name}`, 'tool')
        break

      case 'tool_result':
        addLog(`  工具返回: ${msg.name}`, 'tool')
        break

      case 'chapter_done': {
        const cr: ChapterResult = {
          chapter_id: msg.chapter as string,
          score: msg.score as number,
          passed: msg.passed as boolean,
          retries: msg.retries as number,
          word_count: msg.word_count as number,
          error: (msg.error as string) || '',
        }
        setResults(prev => [...prev, cr])
        setCompletedCount((msg.completed as number) || 0)
        setCurrentPhase('')
        const statusText = cr.passed ? '✓ 通过' : '✗ 未通过'
        addLog(
          `  ${statusText} | 分数: ${cr.score} | 字数: ${cr.word_count} | 修订: ${cr.retries} 次${cr.error ? ' | ' + cr.error : ''}`,
          cr.passed ? 'success' : 'warning'
        )
        break
      }

      case 'chapter_revising':
        setCurrentPhase(`修订中 (${msg.attempt}/${msg.max})`)
        addLog(
          `  ⚠ 分数 ${msg.score} 未达阈值，开始第 ${msg.attempt}/${msg.max} 次修订`,
          'warning'
        )
        break

      case 'outline_generating':
        setCurrentPhase('生成新大纲中...')
        addLog(`  📝 大纲用完，正在自动生成第 ${msg.batch} 批新大纲...`, 'info')
        break

      case 'outline_generated':
        setCurrentPhase('')
        setTotalChapters(prev => prev + (msg.chapters as string[]).length)
        addLog(`  ✓ 已生成 ${(msg.chapters as string[]).length} 个新章节大纲`, 'success')
        break

      case 'outline_failed':
        setCurrentPhase('')
        addLog(`  ✗ 自动生成大纲失败: ${msg.message}`, 'error')
        break

      case 'completed': {
        const summary = msg.summary as Record<string, unknown>
        setStatus('done')
        setCurrentChapter('')
        setCurrentPhase('')
        addLog('', 'info')
        addLog(`═══ 自动写作完成 ═══`, 'success')
        addLog(`已写: ${summary.total_written} 章 | 通过: ${summary.total_passed} 章`, 'success')
        break
      }

      case 'cancelled':
        setStatus('done')
        addLog('用户已停止自动写作', 'warning')
        break

      case 'paused':
        setStatus('paused')
        addLog('已暂停', 'warning')
        break

      case 'resumed':
        setStatus('running')
        addLog('已恢复', 'success')
        break

      case 'error':
        addLog(`错误: ${msg.message}`, 'error')
        break

      default:
        addLog(`未知消息类型: ${msg.type}`, 'warning')
    }
  }, [addLog])

  useEffect(() => {
    handleMessageRef.current = handleMessage
  }, [handleMessage])

  const handleStart = () => {
    setLogs([])
    setResults([])
    setCompletedCount(0)
    setTotalChapters(0)
    setCurrentChapter('')
    setCurrentPhase('')
    connect()
  }

  const handlePause = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'pause' }))
    }
  }

  const handleResume = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resume' }))
    }
  }

  const handleCancel = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel' }))
    }
  }

  const updateConfig = (key: keyof AutoWriteConfig, value: unknown) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  const isRunning = status === 'running' || status === 'paused'

  return (
    <div className="page">
      <h1>🤖 自动写作</h1>

      <div className="help-box">
        <p>
          <strong>自动写作引擎</strong>会循环执行「写作→审查→修订」，直到所有大纲章节写完或手动停止。
          每章写完后自动审查，分数低于阈值会自动修订（最多 N 次）。审查通过才进入下一章。
        </p>
      </div>

      {/* 配置面板 */}
      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setShowConfig(!showConfig)}
          style={{
            background: 'none', border: '1px solid #d0d0d0', borderRadius: 6,
            padding: '6px 12px', fontSize: 13, color: '#666', cursor: 'pointer',
          }}
        >
          {showConfig ? '▼ 隐藏配置' : '▶ 展开配置'}
        </button>
      </div>

      {showConfig && (
        <div style={{
          background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <h3 style={{ marginTop: 0 }}>写作配置</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
                及格分数 (0-100)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="range" min={0} max={100} value={config.score_threshold}
                  onChange={e => updateConfig('score_threshold', +e.target.value)}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 14, fontWeight: 600, width: 36, textAlign: 'right' }}>
                  {config.score_threshold}
                </span>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
                每章最大修订次数
              </label>
              <input
                type="number" min={0} max={10} value={config.max_retries}
                onChange={e => updateConfig('max_retries', +e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
                目标字数
              </label>
              <input
                type="number" min={500} max={10000} step={500} value={config.target_words}
                onChange={e => updateConfig('target_words', +e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
                最多写几章 (0=全部)
              </label>
              <input
                type="number" min={0} max={999} value={config.max_chapters}
                onChange={e => updateConfig('max_chapters', +e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: 4 }}
              />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#666', cursor: 'pointer' }}>
                <input
                  type="checkbox" checked={config.auto_outline}
                  onChange={e => updateConfig('auto_outline', e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                大纲用完时自动生成
              </label>
            </div>
            {config.auto_outline && (
              <div>
                <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
                  每次生成章节数
                </label>
                <input
                  type="number" min={1} max={20} value={config.outline_batch}
                  onChange={e => updateConfig('outline_batch', +e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: 4 }}
                />
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#666', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.continue_on_review_error}
                  onChange={e => updateConfig('continue_on_review_error', e.target.checked)}
                  style={{ accentColor: '#7c8aff' }}
                />
                审查API失败时继续写作（不推荐）
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
                起始章节 (留空=从下一章开始)
              </label>
              <input
                type="text" value={config.start_chapter}
                onChange={e => updateConfig('start_chapter', e.target.value)}
                placeholder="例如: ch_001"
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: 4 }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 4 }}>
                全局写作指导
              </label>
              <textarea
                value={config.guidance}
                onChange={e => updateConfig('guidance', e.target.value)}
                placeholder="可选：给自动写作引擎的全局指导，例如风格要求、情节方向等"
                rows={3}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: 4, resize: 'vertical' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 控制按钮 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {!isRunning && status !== 'done' && (
          <button
            onClick={handleStart}
            style={{
              background: '#7c8aff', color: '#fff', border: 'none', borderRadius: 6,
              padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            ▶ 开始自动写作
          </button>
        )}
        {status === 'running' && (
          <button
            onClick={handlePause}
            style={{
              background: '#ffd700', color: '#333', border: 'none', borderRadius: 6,
              padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            ⏸ 暂停
          </button>
        )}
        {status === 'paused' && (
          <button
            onClick={handleResume}
            style={{
              background: '#4caf50', color: '#fff', border: 'none', borderRadius: 6,
              padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            ▶ 恢复
          </button>
        )}
        {isRunning && (
          <button
            onClick={handleCancel}
            style={{
              background: '#ff6b6b', color: '#fff', border: 'none', borderRadius: 6,
              padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            ⏹ 停止
          </button>
        )}
        {status === 'done' && (
          <button
            onClick={() => {
              setStatus('disconnected')
              setLogs([])
              setResults([])
              setCompletedCount(0)
              setTotalChapters(0)
              Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k))
            }}
            style={{
              background: '#7c8aff', color: '#fff', border: 'none', borderRadius: 6,
              padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            重置
          </button>
        )}
      </div>

      {/* 进度区 */}
      {isRunning && (
        <div style={{
          background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {currentChapter && `当前: ${currentChapter}`}
              {currentPhase && ` - ${currentPhase}`}
            </span>
            <span style={{ fontSize: 13, color: '#666' }}>
              {completedCount} / {totalChapters || '?'} 章
            </span>
          </div>
          <div style={{
            height: 8, background: '#e0e0e0', borderRadius: 4, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: totalChapters > 0 ? `${(completedCount / totalChapters) * 100}%` : '0%',
              background: 'linear-gradient(90deg, #7c8aff, #a78bfa)',
              borderRadius: 4,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
      )}

      {/* 结果表格 */}
      {results.length > 0 && (
        <div style={{
          background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <h3 style={{ marginTop: 0 }}>已完成章节</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>章节</th>
                <th style={{ textAlign: 'center', padding: '8px 12px' }}>分数</th>
                <th style={{ textAlign: 'center', padding: '8px 12px' }}>状态</th>
                <th style={{ textAlign: 'center', padding: '8px 12px' }}>修订次数</th>
                <th style={{ textAlign: 'right', padding: '8px 12px' }}>字数</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{r.chapter_id}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, color: r.passed ? '#4caf50' : '#ff6b6b' }}>
                    {r.score}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    {r.passed
                      ? <span style={{ color: '#4caf50' }}>✓ 通过</span>
                      : <span style={{ color: '#ff6b6b' }}>✗ 未通过</span>
                    }
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>{r.retries}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>{r.word_count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 日志区 */}
      <div style={{
        background: '#1a1a2e', borderRadius: 8, padding: 16,
        maxHeight: 400, overflow: 'auto', fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 12, lineHeight: 1.8,
      }}>
        {logs.length === 0 && (
          <div style={{ color: '#555', textAlign: 'center', padding: 20 }}>
            日志将在自动写作启动后显示...
          </div>
        )}
        {logs.map(log => (
          <div key={log.id} style={{
            color: log.type === 'success' ? '#4caf50'
              : log.type === 'warning' ? '#ffd700'
              : log.type === 'error' ? '#ff6b6b'
              : log.type === 'tool' ? '#a78bfa'
              : '#b0b0c0',
          }}>
            <span style={{ color: '#555', marginRight: 8 }}>{log.time}</span>
            {log.text}
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  )
}
