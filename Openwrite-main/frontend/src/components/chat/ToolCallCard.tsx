import { useState } from 'react'

interface ToolCallCardProps {
  name: string
  args?: Record<string, unknown>
  result?: unknown
  error?: string
  status: 'calling' | 'done' | 'error'
}

export default function ToolCallCard({ name, args, result, error, status }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = status === 'calling' ? '⏳' : status === 'error' ? '✗' : '✓'
  const statusColor = status === 'calling' ? '#f59e0b' : status === 'error' ? '#ef4444' : '#10b981'

  const toolDescs: Record<string, string> = {
    get_status: '查看状态',
    get_context: '查看上下文',
    list_chapters: '列出章节',
    get_truth_files: '查看真相文件',
    query_world: '查询世界设定',
    get_world_relations: '查询世界关系',
    write_chapter: '写章节',
    review_chapter: '审查章节',
    summarize_ideation: '汇总灵感',
    confirm_ideation_summary: '确认灵感汇总',
    generate_outline_draft: '生成大纲',
    run_chapter_preflight: '章节预检',
    delegate_chapter_write: '委托写章',
    delegate_chapter_review: '委托审查',
    generate_foundation_draft: '生成基础设定',
    generate_character_draft: '生成角色草案',
    extract_style_source: '提取风格',
    extract_setting_source: '提取设定',
    review_source_pack: '审查来源包',
    promote_source_pack: '推广来源包',
    prepare_dante_handoff: '准备交接给 Dante',
  }

  const displayName = toolDescs[name] || name

  return (
    <div className="tool-call-card">
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-status" style={{ color: statusColor }}>{statusIcon}</span>
        <span className="tool-call-name">{displayName}</span>
        <span className="tool-call-id">{name}</span>
        <span className="tool-call-toggle">{expanded ? '▼' : '▶'}</span>
      </div>
      {expanded && (
        <div className="tool-call-body">
          {args && Object.keys(args).length > 0 && (
            <div className="tool-call-section">
              <div className="tool-call-label">参数</div>
              <pre className="tool-call-json">{JSON.stringify(args, null, 2)}</pre>
            </div>
          )}
          {result !== undefined && (
            <div className="tool-call-section">
              <div className="tool-call-label">结果</div>
              <pre className="tool-call-json">
                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
          {error && (
            <div className="tool-call-section">
              <div className="tool-call-label" style={{ color: '#ef4444' }}>错误</div>
              <pre className="tool-call-json error">{error}</pre>
            </div>
          )}
        </div>
      )}

      <style>{`
        .tool-call-card {
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 6px;
          margin: 4px 0;
          font-size: 13px;
          overflow: hidden;
        }
        .tool-call-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          cursor: pointer;
          user-select: none;
        }
        .tool-call-header:hover { background: #fef3c7; }
        .tool-call-status { font-size: 14px; }
        .tool-call-name { font-weight: 600; color: #92400e; }
        .tool-call-id { color: #b45309; font-size: 11px; margin-left: auto; }
        .tool-call-toggle { color: #b45309; font-size: 10px; }
        .tool-call-body { border-top: 1px solid #fde68a; padding: 8px 12px; }
        .tool-call-section { margin-bottom: 8px; }
        .tool-call-section:last-child { margin-bottom: 0; }
        .tool-call-label {
          font-size: 11px;
          font-weight: 600;
          color: #92400e;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .tool-call-json {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          font-size: 12px;
          line-height: 1.5;
          font-family: ui-monospace, Consolas, monospace;
          background: #fffdf5;
          padding: 6px 8px;
          border-radius: 4px;
          max-height: 300px;
          overflow-y: auto;
        }
        .tool-call-json.error { background: #fef2f2; color: #991b1b; }
      `}</style>
    </div>
  )
}
