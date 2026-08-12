import { useCallback, useEffect, useState } from 'react'
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
  const [editContent, setEditContent] = useState('')
  const [hierarchy, setHierarchy] = useState<OutlineNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadOutline = useCallback(() => {
    if (!currentNovelId) return
    setLoading(true)
    setError('')
    api.get(`/novels/${currentNovelId}/outline`)
      .then(({ data }) => {
        setContent(data.content || '')
        setEditContent(data.content || '')
        setHierarchy(data.hierarchy)
      })
      .catch((e) => {
        setError(`加载大纲失败: ${e.response?.data?.detail || e.message}`)
      })
      .finally(() => setLoading(false))
  }, [currentNovelId])

  useEffect(() => {
    loadOutline()
  }, [loadOutline])

  const handleSave = async () => {
    if (!currentNovelId) return
    setSaving(true)
    setError('')
    try {
      await api.put(`/novels/${currentNovelId}/outline`, { content: editContent })
      setContent(editContent)
      setEditing(false)
      // Reload to get updated hierarchy
      loadOutline()
    } catch (e: unknown) {
      setError(`保存失败: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditContent(content)
    setEditing(false)
    setError('')
  }

  return (
    <div className="page outline-page">
      <div className="outline-header">
        <h1>大纲</h1>
        <div className="outline-actions">
          {editing ? (
            <>
              <button className="btn-cancel" onClick={handleCancel} disabled={saving}>
                取消
              </button>
              <button className="btn-save" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '💾 保存大纲'}
              </button>
            </>
          ) : (
            <button className="btn-edit" onClick={() => setEditing(true)}>
              ✏️ 编辑大纲
            </button>
          )}
        </div>
      </div>

      <div className="help-box">
        <p>大纲是写作的核心指引。点击"编辑大纲"可直接修改 Markdown 内容，保存后自动同步层级结构。</p>
      </div>

      {loading && <p>加载中...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: 13 }}>{error}</p>}

      <div className="outline-layout">
        <div className="outline-raw">
          <h3>大纲原文</h3>
          {editing ? (
            <textarea
              className="outline-editor"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="输入大纲内容（Markdown 格式）&#10;&#10;# 小说标题&#10;&#10;## 第一卷&#10;### 第一章&#10;章节内容概要..."
            />
          ) : (
            <pre className="outline-content">{content || '(空)'}</pre>
          )}
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
        .outline-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .outline-header h1 { margin: 0; }
        .outline-actions {
          display: flex; gap: 8px;
        }
        .btn-edit, .btn-save, .btn-cancel {
          padding: 8px 16px; border: none; border-radius: 6px;
          font-size: 13px; cursor: pointer; font-weight: 500;
        }
        .btn-edit { background: #7c8aff; color: #fff; }
        .btn-edit:hover { background: #5a6ae0; }
        .btn-save { background: #10b981; color: #fff; }
        .btn-save:hover { background: #059669; }
        .btn-save:disabled { background: #a7f3d0; cursor: not-allowed; }
        .btn-cancel { background: #f3f4f6; color: #666; border: 1px solid #d0d0d0; }
        .btn-cancel:hover { background: #e5e7eb; }

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
        .outline-editor {
          width: 100%;
          min-height: 400px;
          padding: 12px;
          border: 1px solid #d0d0d0;
          border-radius: 6px;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.6;
          resize: vertical;
          outline: none;
        }
        .outline-editor:focus {
          border-color: #7c8aff;
          box-shadow: 0 0 0 2px rgba(124,138,255,0.15);
        }
        .outline-tree {
          font-size: 13px;
        }
        .tree-node { margin: 2px 0; }
        .tree-node-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          border-radius: 4px;
          cursor: default;
          transition: background 0.15s;
        }
        .tree-node-header.has-children { cursor: pointer; }
        .tree-node-header:hover { background: #f5f5ff; }
        .tree-expand {
          font-size: 10px; color: #888;
          transition: transform 0.2s; width: 12px; text-align: center;
        }
        .tree-expand.expanded { transform: rotate(90deg); }
        .tree-expand-placeholder { width: 12px; }
        .tree-icon { font-size: 14px; }
        .tree-title { flex: 1; font-weight: 500; }
        .tree-type-badge {
          font-size: 11px; padding: 1px 6px;
          background: #f0f0f0; border-radius: 10px; color: #666;
        }
        .tree-word-count { font-size: 11px; color: #888; }
        .tree-children {
          border-left: 1px solid #e0e0e0;
          margin-left: 6px; padding-left: 4px;
        }
        .empty-hint { color: #aaa; text-align: center; padding: 20px; }
      `}</style>
    </div>
  )
}
