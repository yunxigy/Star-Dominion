/* eslint-disable react-hooks/immutability -- the force simulation intentionally mutates ref-owned nodes between animation frames */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'
import NoNovelGuard from '../components/NoNovelGuard'

interface GraphNode {
  id: string
  name: string
  tier: string
  summary: string
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface GraphEdge {
  source: string
  target: string
  label: string
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const tierColors: Record<string, string> = {
  '主角': '#7c8aff',
  '重要配角': '#f59e0b',
  '普通配角': '#10b981',
  '炮灰': '#9ca3af',
}

function getTierColor(tier: string): string {
  for (const [key, color] of Object.entries(tierColors)) {
    if (tier.includes(key)) return color
  }
  return '#7c8aff'
}

function initializePositions(nodes: GraphNode[]): GraphNode[] {
  const w = 800, h = 500
  const cx = w / 2, cy = h / 2
  nodes.forEach((node, index) => {
    const angle = (2 * Math.PI * index) / nodes.length
    const radius = Math.min(w, h) * 0.3
    node.x = cx + radius * Math.cos(angle)
    node.y = cy + radius * Math.sin(angle)
    node.vx = 0
    node.vy = 0
  })
  return [...nodes]
}

export default function GraphPage() {
  const { currentNovelId } = useNovelStore()
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const animRef = useRef<number>(0)

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/graph/characters`)
      .then(({ data }) => {
        setGraph(data)
        nodesRef.current = initializePositions(data.nodes)
      })
      .catch(() => setGraph(null))
      .finally(() => setLoading(false))
  }, [currentNovelId])

  const simulate = useCallback(() => {
    const nodes = nodesRef.current
    if (!graph || nodes.length === 0) return

    const w = 800, h = 500
    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    // Simple force simulation
    for (let iter = 0; iter < 3; iter++) {
      // Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = (nodes[j].x || 0) - (nodes[i].x || 0)
          const dy = (nodes[j].y || 0) - (nodes[i].y || 0)
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
          const force = 500 / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          nodes[i].vx = (nodes[i].vx || 0) - fx
          nodes[i].vy = (nodes[i].vy || 0) - fy
          nodes[j].vx = (nodes[j].vx || 0) + fx
          nodes[j].vy = (nodes[j].vy || 0) + fy
        }
      }

      // Attraction along edges
      for (const edge of graph.edges) {
        const src = nodeMap.get(edge.source)
        const tgt = nodeMap.get(edge.target)
        if (!src || !tgt) continue
        const dx = (tgt.x || 0) - (src.x || 0)
        const dy = (tgt.y || 0) - (src.y || 0)
        const dist = Math.sqrt(dx * dx + dy * dy)
        const force = (dist - 120) * 0.01
        const fx = (dx / Math.max(dist, 1)) * force
        const fy = (dy / Math.max(dist, 1)) * force
        src.vx = (src.vx || 0) + fx
        src.vy = (src.vy || 0) + fy
        tgt.vx = (tgt.vx || 0) - fx
        tgt.vy = (tgt.vy || 0) - fy
      }

      // Center gravity
      for (const node of nodes) {
        node.vx = (node.vx || 0) + (w / 2 - (node.x || 0)) * 0.001
        node.vy = (node.vy || 0) + (h / 2 - (node.y || 0)) * 0.001
      }

      // Apply velocity with damping
      for (const node of nodes) {
        node.vx = (node.vx || 0) * 0.8
        node.vy = (node.vy || 0) * 0.8
        node.x = Math.max(40, Math.min(w - 40, (node.x || 0) + (node.vx || 0)))
        node.y = Math.max(40, Math.min(h - 40, (node.y || 0) + (node.vy || 0)))
      }
    }

    setGraph(prev => prev ? { ...prev, nodes: [...nodes] } : null)
  }, [graph])

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return
    let frame = 0
    const tick = () => {
      if (frame < 200) {
        simulate()
        frame++
        animRef.current = requestAnimationFrame(tick)
      }
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  // The graph object changes every animation frame; only a node-count change
  // should restart the simulation lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph?.nodes.length])

  const handleDragStart = (node: GraphNode, e: React.MouseEvent) => {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return

    const pt = svg.createSVGPoint()
    const getPos = (e: MouseEvent) => {
      pt.x = e.clientX
      pt.y = e.clientY
      const ctm = svg.getScreenCTM()?.inverse()
      if (!ctm) return { x: 0, y: 0 }
      const svgP = pt.matrixTransform(ctm)
      return { x: svgP.x, y: svgP.y }
    }

    const onMove = (ev: MouseEvent) => {
      const pos = getPos(ev)
      const nodes = nodesRef.current
      const n = nodes.find(nn => nn.id === node.id)
      if (n) {
        n.x = pos.x
        n.y = pos.y
        n.vx = 0
        n.vy = 0
        setGraph(prev => prev ? { ...prev, nodes: [...nodes] } : null)
      }
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    setSelected(node)
  }

  if (loading) return <NoNovelGuard><div className="page"><p>加载中...</p></div></NoNovelGuard>

  return (
    <NoNovelGuard>
    <div className="page graph-page">
      <h1>角色关系图</h1>
      <div className="help-box">
        <p>拖拽节点调整位置，点击节点查看详情。连线表示角色之间的关系。</p>
      </div>

      {graph && graph.nodes.length > 0 ? (
        <div className="graph-container">
          <svg
            ref={svgRef}
            viewBox="0 0 800 500"
            className="graph-svg"
          >
            {/* Edges */}
            {graph.edges.map((edge, i) => {
              const src = graph.nodes.find(n => n.id === edge.source)
              const tgt = graph.nodes.find(n => n.id === edge.target)
              if (!src || !tgt) return null
              return (
                <g key={`edge-${i}`}>
                  <line
                    x1={src.x || 0}
                    y1={src.y || 0}
                    x2={tgt.x || 0}
                    y2={tgt.y || 0}
                    stroke="#d0d0d0"
                    strokeWidth={1.5}
                  />
                  {edge.label && (
                    <text
                      x={((src.x || 0) + (tgt.x || 0)) / 2}
                      y={((src.y || 0) + (tgt.y || 0)) / 2 - 6}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#999"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              )
            })}

            {/* Nodes */}
            {graph.nodes.map((node) => {
              const color = getTierColor(node.tier)
              const isSelected = selected?.id === node.id
              return (
                <g
                  key={node.id}
                  onMouseDown={(e) => handleDragStart(node, e)}
                  style={{ cursor: 'grab' }}
                >
                  <circle
                    cx={node.x || 0}
                    cy={node.y || 0}
                    r={isSelected ? 28 : 24}
                    fill={color}
                    stroke={isSelected ? '#333' : '#fff'}
                    strokeWidth={isSelected ? 3 : 2}
                    opacity={0.9}
                  />
                  <text
                    x={node.x || 0}
                    y={(node.y || 0) + 4}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={600}
                    fill="#fff"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.name.length > 4 ? node.name.slice(0, 4) : node.name}
                  </text>
                </g>
              )
            })}
          </svg>

          {/* Legend */}
          <div className="graph-legend">
            {Object.entries(tierColors).map(([label, color]) => (
              <div key={label} className="legend-item">
                <span className="legend-dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
          </div>

          {/* Selected node detail */}
          {selected && (
            <div className="node-detail">
              <h3>{selected.name}</h3>
              {selected.tier && <p className="node-tier">{selected.tier}</p>}
              {selected.summary && <p className="node-summary">{selected.summary}</p>}
              <button className="close-btn" onClick={() => setSelected(null)}>✕</button>
            </div>
          )}
        </div>
      ) : (
        <p className="empty-hint">暂无角色数据。</p>
      )}

      <style>{`
        .graph-page { max-width: 1000px; }
        .graph-container {
          position: relative; background: #fff; border: 1px solid #e0e0e0;
          border-radius: 12px; margin-top: 16px; overflow: hidden;
        }
        .graph-svg {
          width: 100%; height: auto; display: block;
          min-height: 400px;
        }
        .graph-legend {
          position: absolute; top: 12px; right: 12px;
          background: rgba(255,255,255,0.9); border-radius: 8px;
          padding: 8px 12px; display: flex; flex-direction: column; gap: 4px;
          font-size: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.1);
        }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .node-detail {
          position: absolute; bottom: 16px; left: 16px; right: 16px;
          background: rgba(255,255,255,0.95); border-radius: 10px;
          padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .node-detail h3 { margin: 0 0 4px; font-size: 16px; }
        .node-tier { font-size: 12px; color: #7c8aff; margin: 0 0 8px; }
        .node-summary { font-size: 13px; color: #555; margin: 0; line-height: 1.6; }
        .close-btn {
          position: absolute; top: 8px; right: 12px;
          background: none; border: none; font-size: 16px;
          cursor: pointer; color: #aaa;
        }
        .close-btn:hover { color: #333; }
        .empty-hint { color: #aaa; text-align: center; padding: 40px; }
      `}</style>
    </div>
    </NoNovelGuard>
  )
}
