import { useNovelStore } from '../../store/novelStore'

export default function StatusBar() {
  const { status, loading, error } = useNovelStore()

  const stage = (status?.book_stage as string) || '未知'
  const chapters = (status?.chapters_written as number) || 0

  const stageLabels: Record<string, string> = {
    DISCOVERY: '探索期',
    FOUNDATION: '奠基期',
    ROLLING_OUTLINE: '滚动大纲',
    CHAPTER_PREFLIGHT: '章节预检',
    DRAFTING: '写作中',
    REVIEW_AND_REVISE: '审查修订',
    SETTLEMENT: '状态结算',
    MILESTONE_REVIEW: '里程碑审查',
  }

  return (
    <footer className="statusbar">
      <span className="statusbar-item">
        阶段: <strong>{stageLabels[stage] || stage}</strong>
      </span>
      <span className="statusbar-item">
        已写章节: <strong>{chapters}</strong>
      </span>
      {loading && <span className="statusbar-item loading">加载中...</span>}
      {error && <span className="statusbar-item error">{error}</span>}
    </footer>
  )
}
