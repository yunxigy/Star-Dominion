import { useState } from 'react'
import { useNovelStore } from '../../store/novelStore'
import api from '../../api/client'

export default function TopBar() {
  const { novels, currentNovelId, selectNovel, loadNovels, config } = useNovelStore()
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!currentNovelId) return
    if (!confirm(`确定删除小说「${currentNovelId}」？\n文件会移到回收站，但不会永久删除。`)) return
    setDeleting(true)
    try {
      await api.delete(`/novels/${currentNovelId}`)
      await loadNovels()
    } catch (e: unknown) {
      alert(`删除失败: ${(e as Error).message}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <select
          className="novel-selector"
          value={currentNovelId || ''}
          onChange={(e) => selectNovel(e.target.value)}
        >
          {novels.length === 0 && <option value="">暂无小说</option>}
          {novels.map((n) => (
            <option key={n.novel_id} value={n.novel_id}>
              {n.novel_id}
            </option>
          ))}
        </select>
        {currentNovelId && (
          <button
            className="novel-delete-btn"
            onClick={handleDelete}
            disabled={deleting}
            title="删除当前小说"
          >
            {deleting ? '...' : '🗑️'}
          </button>
        )}
        {config?.current_chapter && (
          <span className="topbar-info">
            卷 {config.current_arc} / 章 {config.current_chapter}
          </span>
        )}
      </div>
      <div className="topbar-right">
        <span className="topbar-version">OpenWrite v5.4</span>
      </div>
    </header>
  )
}
