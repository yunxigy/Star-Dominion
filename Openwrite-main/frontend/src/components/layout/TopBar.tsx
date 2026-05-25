import { useNovelStore } from '../../store/novelStore'

export default function TopBar() {
  const { novels, currentNovelId, selectNovel, config } = useNovelStore()

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
        {config?.current_chapter && (
          <span className="topbar-info">
            卷 {config.current_arc} / 章 {config.current_chapter}
          </span>
        )}
      </div>
    </header>
  )
}
