import { useCallback, useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'

interface ForeshadowNode {
  id: string
  content: string
  status?: string
  weight?: number
  layer?: string
  target_chapter?: string
  tags?: string[]
}

interface ForeshadowEdge {
  from_: string
  to: string
  type?: string
}

export default function ForeshadowingPage() {
  const { currentNovelId } = useNovelStore()
  const [nodes, setNodes] = useState<ForeshadowNode[]>([])
  const [edges, setEdges] = useState<ForeshadowEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadData = useCallback(() => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/foreshadowing`)
      .then(({ data }) => {
        setNodes(data.nodes || [])
        setEdges(data.edges || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [currentNovelId])

  useEffect(() => { loadData() }, [loadData])

  const handleDelete = async (nodeId: string) => {
    if (!currentNovelId) return
    if (!confirm(`确定删除伏笔「${nodeId}」？相关关系也会被删除，此操作不可撤销。`)) return
    setDeleting(nodeId)
    try {
      await api.delete(`/novels/${currentNovelId}/foreshadowing/${encodeURIComponent(nodeId)}`)
      loadData()
    } catch {
      alert('删除失败')
    } finally {
      setDeleting(null)
    }
  }

  const statusColors: Record<string, string> = {
    '埋伏': '#10b981',
    '待收': '#f59e0b',
    '已收': '#6366f1',
    '废弃': '#9ca3af',
  }

  return (
    <div className="page foreshadowing-page">
      <h1>伏笔管理</h1>
      <div className="help-box">
        <p>管理小说中的伏笔（草蛇灰线）。伏笔有三种状态：<strong>埋伏</strong>（已写入但未揭示）、<strong>待收</strong>（到了该回收的时机）、<strong>已收</strong>（已成功回收）。节点之间的边表示伏笔之间的依赖、强化或反转关系。新增伏笔请在<strong>对话</strong>页面告诉 Dante/Goethe，或使用 CLI 命令管理。</p>
      </div>
      {loading && <p>加载中...</p>}

      <div className="foreshadowing-section">
        <h2>伏笔节点 ({nodes.length})</h2>
        {nodes.length > 0 ? (
          <div className="foreshadow-grid">
            {nodes.map((node) => (
              <div key={node.id} className="foreshadow-card">
                <div className="foreshadow-card-top">
                  <div className="foreshadow-id">{node.id}</div>
                  <button
                    className="foreshadow-delete-btn"
                    title="删除伏笔"
                    disabled={deleting === node.id}
                    onClick={() => handleDelete(node.id)}
                  >
                    {deleting === node.id ? '...' : '✕'}
                  </button>
                </div>
                <div className="foreshadow-content">{node.content}</div>
                <div className="foreshadow-meta">
                  {node.status && (
                    <span className="foreshadow-status" style={{ background: statusColors[node.status] || '#888' }}>
                      {node.status}
                    </span>
                  )}
                  {node.layer && <span className="foreshadow-tag">{node.layer}</span>}
                  {node.weight !== undefined && <span className="foreshadow-tag">权重: {node.weight}</span>}
                  {node.target_chapter && <span className="foreshadow-tag">目标章: {node.target_chapter}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-hint">暂无伏笔节点。</p>
        )}
      </div>

      <div className="foreshadowing-section">
        <h2>伏笔关系 ({edges.length})</h2>
        {edges.length > 0 ? (
          <div className="foreshadow-edge-list">
            {edges.map((edge, i) => (
              <div key={i} className="foreshadow-edge">
                <span className="edge-from">{edge.from_}</span>
                <span className="edge-arrow">→</span>
                <span className="edge-to">{edge.to}</span>
                {edge.type && <span className="edge-type">{edge.type}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-hint">暂无伏笔关系。</p>
        )}
      </div>

      <style>{`
        .foreshadowing-section {
          margin-top: 24px;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 16px;
        }
        .foreshadow-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
        }
        .foreshadow-card {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 12px;
          background: #fafafa;
        }
        .foreshadow-card-top { display: flex; justify-content: space-between; align-items: center; }
        .foreshadow-id { font-weight: 600; font-size: 14px; color: #333; }
        .foreshadow-delete-btn {
          background: none; border: none; cursor: pointer; color: #ccc;
          font-size: 14px; padding: 2px 6px; border-radius: 4px; line-height: 1;
        }
        .foreshadow-delete-btn:hover { color: #ef4444; background: #fef2f2; }
        .foreshadow-delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .foreshadow-content { font-size: 13px; color: #555; margin: 8px 0; line-height: 1.6; }
        .foreshadow-meta { display: flex; flex-wrap: wrap; gap: 6px; }
        .foreshadow-status {
          font-size: 11px; color: #fff; padding: 2px 8px; border-radius: 10px;
        }
        .foreshadow-tag {
          font-size: 11px; background: #e8eaff; color: #5a6ae0;
          padding: 2px 8px; border-radius: 10px;
        }
        .foreshadow-edge-list { display: flex; flex-direction: column; gap: 8px; }
        .foreshadow-edge {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; background: #f5f5f8; border-radius: 6px; font-size: 13px;
        }
        .edge-from { font-weight: 600; color: #333; }
        .edge-arrow { color: #7c8aff; }
        .edge-to { font-weight: 600; color: #333; }
        .edge-type { font-size: 11px; background: #e8eaff; color: #5a6ae0; padding: 2px 8px; border-radius: 10px; margin-left: auto; }
        .empty-hint { color: #aaa; text-align: center; padding: 20px; }
      `}</style>
    </div>
  )
}
