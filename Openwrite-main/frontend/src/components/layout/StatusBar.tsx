import { useNovelStore } from '../../store/novelStore'
import { stageLabels } from '../../lib/constants'

export default function StatusBar() {
  const { currentNovelId, status, loading, error } = useNovelStore()

  if (!currentNovelId) {
    return (
      <footer className="statusbar">
        <span className="statusbar-item">请先选择一本小说</span>
      </footer>
    )
  }

  const stage = (status?.book_stage as string) || ''
  const chapters = (status?.chapters_written as number) || 0

  return (
    <footer className="statusbar">
      <span className="statusbar-item">
        阶段: <strong>{stage ? (stageLabels[stage] || stage) : '-'}</strong>
      </span>
      <span className="statusbar-item">
        已写章节: <strong>{chapters}</strong>
      </span>
      {loading && <span className="statusbar-item loading">加载中...</span>}
      {error && <span className="statusbar-item error">{error}</span>}
    </footer>
  )
}
