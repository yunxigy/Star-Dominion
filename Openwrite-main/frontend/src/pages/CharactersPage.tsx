import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'

interface Character {
  name: string
  file: string
  tier?: string
  summary?: string
}

export default function CharactersPage() {
  const { currentNovelId } = useNovelStore()
  const [characters, setCharacters] = useState<Character[]>([])
  const [selected, setSelected] = useState<{ name: string; content: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const loadCharacters = () => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/characters`)
      .then(({ data }) => setCharacters(data.characters || []))
      .catch(() => setCharacters([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCharacters() }, [currentNovelId])

  const handleSelect = async (ch: Character) => {
    if (!currentNovelId) return
    try {
      const { data } = await api.get(`/novels/${currentNovelId}/characters/${ch.name}`)
      setSelected({ name: data.name, content: data.content })
    } catch {
      setSelected(null)
    }
  }

  const handleDelete = async (name: string) => {
    if (!currentNovelId) return
    if (!confirm(`确定删除角色「${name}」？此操作不可撤销。`)) return
    setDeleting(name)
    try {
      await api.delete(`/novels/${currentNovelId}/characters/${encodeURIComponent(name)}`)
      if (selected?.name === name) setSelected(null)
      loadCharacters()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '删除失败'
      alert(msg)
    } finally {
      setDeleting(null)
    }
  }

  const tierLabels: Record<string, string> = {
    PROTAGONIST: '主角',
    MAJOR: '重要配角',
    MINOR: '普通配角',
    EXTRA: '炮灰',
  }

  return (
    <div className="page characters-page">
      <h1>角色管理</h1>
      <div className="help-box">
        <p>查看和管理角色档案。左侧列表显示所有角色，点击可查看完整档案。角色标签含义：<strong>主角</strong>（核心人物）、<strong>重要配角</strong>（关键配角）、<strong>普通配角</strong>（出场较少）、<strong>炮灰</strong>（一次性角色）。新建角色请在<strong>对话</strong>页面让 Goethe 创建，或直接在 <code>src/characters/</code> 目录下添加 Markdown 文件。</p>
      </div>
      {loading && <p>加载中...</p>}

      <div className="characters-layout">
        <div className="character-list">
          <div className="character-list-header">角色列表 ({characters.length})</div>
          {characters.map((ch) => (
            <div
              key={ch.file}
              className={`character-item ${selected?.name === ch.name ? 'active' : ''}`}
              onClick={() => handleSelect(ch)}
            >
              <div className="char-item-top">
                <div className="char-name">{ch.name}</div>
                <button
                  className="char-delete-btn"
                  title="删除角色"
                  disabled={deleting === ch.name}
                  onClick={(e) => { e.stopPropagation(); handleDelete(ch.name) }}
                >
                  {deleting === ch.name ? '...' : '✕'}
                </button>
              </div>
              {ch.tier && <span className="char-tier">{tierLabels[ch.tier] || ch.tier}</span>}
              {ch.summary && <div className="char-summary">{ch.summary}</div>}
            </div>
          ))}
          {characters.length === 0 && !loading && <p className="empty-hint">暂无角色。</p>}
        </div>

        <div className="character-detail">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              <pre className="character-content">{selected.content}</pre>
            </>
          ) : (
            <p className="empty-hint">点击左侧角色查看详情。</p>
          )}
        </div>
      </div>

      <style>{`
        .characters-layout {
          display: flex;
          gap: 24px;
          margin-top: 16px;
          height: calc(100vh - 260px);
        }
        .character-list {
          width: 260px;
          min-width: 260px;
          overflow-y: auto;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
        }
        .character-list-header {
          padding: 10px 12px;
          font-weight: 600;
          font-size: 13px;
          color: #666;
          border-bottom: 1px solid #e0e0e0;
          background: #fafafa;
        }
        .character-item {
          padding: 10px 12px;
          cursor: pointer;
          border-bottom: 1px solid #f0f0f0;
        }
        .character-item:hover { background: #f5f5ff; }
        .character-item.active { background: #e8eaff; border-left: 3px solid #7c8aff; }
        .char-name { font-weight: 600; font-size: 14px; }
        .char-item-top { display: flex; justify-content: space-between; align-items: center; }
        .char-delete-btn {
          background: none; border: none; cursor: pointer; color: #ccc;
          font-size: 14px; padding: 2px 6px; border-radius: 4px; line-height: 1;
        }
        .char-delete-btn:hover { color: #ef4444; background: #fef2f2; }
        .char-delete-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .char-tier {
          display: inline-block;
          font-size: 11px;
          background: #e8eaff;
          color: #5a6ae0;
          padding: 1px 6px;
          border-radius: 3px;
          margin-top: 2px;
        }
        .char-summary { font-size: 12px; color: #888; margin-top: 4px; }
        .character-detail {
          flex: 1;
          overflow-y: auto;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 20px;
        }
        .character-content {
          white-space: pre-wrap;
          word-break: break-word;
          font-family: inherit;
          font-size: 14px;
          line-height: 1.8;
          margin-top: 12px;
        }
        .empty-hint { color: #aaa; text-align: center; padding: 20px; }
      `}</style>
    </div>
  )
}
