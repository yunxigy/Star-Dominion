import type { ReactNode } from 'react'
import { useNovelStore } from '../store/novelStore'

interface Props {
  children: ReactNode
}

export default function NoNovelGuard({ children }: Props) {
  const { currentNovelId } = useNovelStore()

  if (!currentNovelId) {
    return (
      <div className="page">
        <div className="no-novel-hint">
          <div className="no-novel-icon">📖</div>
          <h2>尚未选择小说</h2>
          <p>请先在顶部导航栏选择一本小说，再进行操作。</p>
        </div>
        <style>{`
          .no-novel-hint {
            text-align: center;
            padding: 80px 20px;
            color: #888;
          }
          .no-novel-icon {
            font-size: 48px;
            margin-bottom: 16px;
          }
          .no-novel-hint h2 {
            color: #555;
            margin: 0 0 8px;
          }
          .no-novel-hint p {
            margin: 0;
            font-size: 14px;
          }
        `}</style>
      </div>
    )
  }

  return <>{children}</>
}
