import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'

interface WorldEntity {
  name: string
  type: string
  description?: string
  attributes?: Record<string, unknown>
}

interface WorldRelation {
  source: string
  target: string
  type: string
  description?: string
}

const entityTypes: Record<string, { icon: string; color: string }> = {
  character: { icon: '👤', color: '#7c8aff' },
  location: { icon: '📍', color: '#10b981' },
  organization: { icon: '🏛️', color: '#f59e0b' },
  item: { icon: '📦', color: '#8b5cf6' },
  ability: { icon: '⚡', color: '#ef4444' },
  event: { icon: '📅', color: '#06b6d4' },
}

function EntityCard({ entity }: { entity: WorldEntity }) {
  const typeInfo = entityTypes[entity.type] || { icon: '📄', color: '#666' }
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="entity-card" style={{ borderLeftColor: typeInfo.color }}>
      <div className="entity-header" onClick={() => setExpanded(!expanded)}>
        <span className="entity-icon">{typeInfo.icon}</span>
        <div className="entity-info">
          <div className="entity-name">{entity.name}</div>
          <div className="entity-type">{entity.type}</div>
        </div>
        {entity.attributes && Object.keys(entity.attributes).length > 0 && (
          <span className="entity-expand">{expanded ? '▼' : '▶'}</span>
        )}
      </div>
      {entity.description && (
        <div className="entity-desc">{entity.description}</div>
      )}
      {expanded && entity.attributes && (
        <div className="entity-attributes">
          {Object.entries(entity.attributes).map(([key, value]) => (
            <div key={key} className="entity-attr">
              <span className="attr-key">{key}:</span>
              <span className="attr-value">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RelationCard({ relation }: { relation: WorldRelation }) {
  return (
    <div className="relation-card">
      <div className="relation-nodes">
        <span className="relation-node">{relation.source}</span>
        <span className="relation-arrow">→</span>
        <span className="relation-node">{relation.target}</span>
      </div>
      <div className="relation-type">{relation.type}</div>
      {relation.description && (
        <div className="relation-desc">{relation.description}</div>
      )}
    </div>
  )
}

export default function WorldPage() {
  const { currentNovelId } = useNovelStore()
  const [entities, setEntities] = useState<WorldEntity[]>([])
  const [relations, setRelations] = useState<WorldRelation[]>([])
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState<string>('')

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    Promise.all([
      api.get(`/novels/${currentNovelId}/world/entities`).then((r) => r.data.entities || []),
      api.get(`/novels/${currentNovelId}/world/relations`).then((r) => r.data.relations || []),
    ])
      .then(([e, r]) => { setEntities(e); setRelations(r) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [currentNovelId])

  const entityTypesList = Array.from(new Set(entities.map((e) => e.type)))
  const filteredEntities = filterType
    ? entities.filter((e) => e.type === filterType)
    : entities

  return (
    <div className="page world-page">
      <h1>世界设定</h1>
      <div className="help-box">
        <p>查看小说的世界观设定，包括实体（组织、地点、能力体系等）和它们之间的关系。这些数据来自 <code>src/world/</code> 目录下的文档。修改世界设定请直接编辑对应文件后运行 <code>openwrite sync</code>，或在<strong>对话</strong>页面让 Goethe 帮你操作。</p>
      </div>
      {loading && <p>加载中...</p>}

      <div className="world-section">
        <div className="section-header">
          <h2>实体列表 ({entities.length})</h2>
          <div className="type-filters">
            <button
              className={`filter-btn ${filterType === '' ? 'active' : ''}`}
              onClick={() => setFilterType('')}
            >
              全部
            </button>
            {entityTypesList.map((type) => (
              <button
                key={type}
                className={`filter-btn ${filterType === type ? 'active' : ''}`}
                onClick={() => setFilterType(type)}
              >
                {entityTypes[type]?.icon || '📄'} {type}
              </button>
            ))}
          </div>
        </div>
        {filteredEntities.length > 0 ? (
          <div className="entities-grid">
            {filteredEntities.map((entity) => (
              <EntityCard key={entity.name} entity={entity} />
            ))}
          </div>
        ) : (
          <p className="empty-hint">暂无世界实体。</p>
        )}
      </div>

      <div className="world-section">
        <h2>关系图谱 ({relations.length})</h2>
        {relations.length > 0 ? (
          <div className="relations-grid">
            {relations.map((relation, idx) => (
              <RelationCard key={idx} relation={relation} />
            ))}
          </div>
        ) : (
          <p className="empty-hint">暂无世界关系。</p>
        )}
      </div>

      <style>{`
        .world-section {
          margin-top: 24px;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 16px;
        }
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 16px;
        }
        .section-header h2 {
          margin: 0;
        }
        .type-filters {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .filter-btn {
          padding: 4px 10px;
          border: 1px solid #d0d0d0;
          background: #fff;
          border-radius: 14px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .filter-btn:hover {
          border-color: #7c8aff;
        }
        .filter-btn.active {
          background: #7c8aff;
          color: #fff;
          border-color: #7c8aff;
        }
        .entities-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
        }
        .entity-card {
          background: #fafafa;
          border-radius: 6px;
          border: 1px solid #e0e0e0;
          border-left: 3px solid #666;
          padding: 12px;
          transition: box-shadow 0.15s;
        }
        .entity-card:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .entity-header {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }
        .entity-icon {
          font-size: 18px;
        }
        .entity-info {
          flex: 1;
        }
        .entity-name {
          font-weight: 600;
          font-size: 14px;
        }
        .entity-type {
          font-size: 11px;
          color: #888;
        }
        .entity-expand {
          font-size: 10px;
          color: #888;
        }
        .entity-desc {
          font-size: 12px;
          color: #666;
          margin-top: 8px;
          line-height: 1.5;
        }
        .entity-attributes {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #e0e0e0;
        }
        .entity-attr {
          font-size: 12px;
          margin: 4px 0;
        }
        .attr-key {
          color: #888;
          margin-right: 4px;
        }
        .attr-value {
          color: #333;
        }
        .relations-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 12px;
        }
        .relation-card {
          background: #fafafa;
          border-radius: 6px;
          border: 1px solid #e0e0e0;
          padding: 12px;
        }
        .relation-nodes {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .relation-node {
          font-weight: 600;
          font-size: 13px;
          color: #333;
        }
        .relation-arrow {
          color: #7c8aff;
          font-size: 14px;
        }
        .relation-type {
          font-size: 11px;
          padding: 2px 8px;
          background: #e8eaff;
          border-radius: 10px;
          display: inline-block;
          color: #5a6ae0;
        }
        .relation-desc {
          font-size: 12px;
          color: #666;
          margin-top: 6px;
          line-height: 1.5;
        }
        .empty-hint { color: #aaa; text-align: center; padding: 20px; }
      `}</style>
    </div>
  )
}
