import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'

interface OutlineNode {
  id: string
  title: string
  type: 'arc' | 'volume' | 'chapter' | 'section'
  children?: OutlineNode[]
  description?: string
  word_count?: number
}

function OutlineTreeNode({ node, depth = 0 }: { node: OutlineNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = node.children && node.children.length > 0

  const typeIcons: Record<string, string> = {
    arc: '📚',
    volume: '📖',
    chapter: '📝',
    section: '📄',
  }

  const typeLabels: Record<string, string> = {
    arc: '卷',
    volume: '册',
    chapter: '章',
    section: '节',
  }

  return (
    <div className="tree-node" style={{ marginLeft: depth * 20 }}>
      <div
        className={`tree-node-header ${hasChildren ? 'has-children' : ''}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren && (
          <span className={`tree-expand ${expanded ? 'expanded' : ''}`}>▶</span>
        )}
        {!hasChildren && <span className="tree-expand-placeholder" />}
        <span className="tree-icon">{typeIcons[node.type] || '📄'}</span>
        <span className="tree-title">{node.title}</span>
        <span className="tree-type-badge">{typeLabels[node.type] || node.type}</span>
        {node.word_count && (
          <span className="tree-word-count">{node.word_count}字</span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="tree-children">
          {node.children!.map((child) => (
            <OutlineTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function OutlinePage() {
  const { currentNovelId } = useNovelStore()
  const [content, setContent] = useState('')
  const [hierarchy, setHierarchy] = useState<OutlineNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    setError('')
    api.get(`/novels/${currentNovelId}/outline`)
      .then(({ data }) => {
        setContent(data.content || '')
        setHierarchy(data.hierarchy)
      })
      .catch((e) => {
        setError(`加载大纲失败: ${e.response?.data?.detail || e.message}`)
      })
      .finally(() => setLoading(false))
  }, [currentNovelId])

  return (
    <div className="page outline-page">
      <h1>大纲</h1>
      <div className="help-box">
        <p>查看当前小说的大纲。左侧是大纲原文（Markdown 格式），右侧是系统解析后的大纲层级结构（卷→节→章）。大纲是写作的核心指引，修改大纲请在<strong>对话</strong>页面让 Goethe 帮你操作，或直接编辑 <code>src/outline.md</code> 文件后运行 <code>openwrite sync</code>。</p>
      </div>
      {loading && <p>加载中...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}

      <div className="outline-layout">
        <div className="outline-raw">
          <h3>大纲原文</h3>
          <pre className="outline-content">{content || '(空)'}</pre>
        </div>
        <div className="outline-hierarchy">
          <h3>层级结构</h3>
          {hierarchy && hierarchy.length > 0 ? (
            <div className="outline-tree">
              {hierarchy.map((node) => (
                <OutlineTreeNode key={node.id} node={node} />
              ))}
            </div>
          ) : (
            <p className="empty-hint">暂无大纲层级结构。</p>
          )}
        </div>
      </div>

      <style>{`
        .outline-layout {
          display: flex;
          gap: 24px;
          margin-top: 16px;
        }
        .outline-raw, .outline-hierarchy {
          flex: 1;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 16px;
          overflow: auto;
          max-height: calc(100vh - 260px);
        }
        .outline-content {
          white-space: pre-wrap;
          word-break: break-word;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.6;
        }
        .outline-tree {
          font-size: 13px;
        }
        .tree-node {
          margin: 2px 0;
        }
        .tree-node-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          border-radius: 4px;
          cursor: default;
          transition: background 0.15s;
        }
        .tree-node-header.has-children {
          cursor: pointer;
        }
        .tree-node-header:hover {
          background: #f5f5ff;
        }
        .tree-expand {
          font-size: 10px;
          color: #888;
          transition: transform 0.2s;
          width: 12px;
          text-align: center;
        }
        .tree-expand.expanded {
          transform: rotate(90deg);
        }
        .tree-expand-placeholder {
          width: 12px;
        }
        .tree-icon {
          font-size: 14px;
        }
        .tree-title {
          flex: 1;
          font-weight: 500;
        }
        .tree-type-badge {
          font-size: 11px;
          padding: 1px 6px;
          background: #f0f0f0;
          border-radius: 10px;
          color: #666;
        }
        .tree-word-count {
          font-size: 11px;
          color: #888;
        }
        .tree-children {
          border-left: 1px solid #e0e0e0;
          margin-left: 6px;
          padding-left: 4px;
        }
        .empty-hint { color: #aaa; text-align: center; padding: 20px; }
      `}</style>
    </div>
  )
}
