import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'

export default function TruthFilesPage() {
  const { currentNovelId } = useNovelStore()
  const [truth, setTruth] = useState({ current_state: '', ledger: '', relationships: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/truth`)
      .then(({ data }) => setTruth(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [currentNovelId])

  const files = [
    { key: 'current_state', label: '当前状态', desc: '世界当前状态：地点、事件、人物位置等运行时信息' },
    { key: 'ledger', label: '资源台账', desc: '资源消耗与获取记录：金钱、道具、能力值变化等' },
    { key: 'relationships', label: '人物关系', desc: '角色之间的关系矩阵：盟友、敌对、情感等' },
  ]

  return (
    <div className="page truth-page">
      <h1>真相文件</h1>
      <div className="help-box">
        <p>真相文件是系统自动维护的运行时状态，记录了故事推进过程中积累的事实。这三个文件由 Agent 在每次写章后自动更新，确保后续章节的事实一致性。<strong>一般不需要手动修改</strong>，除非发现明显的事实错误需要修正。</p>
      </div>
      {loading && <p>加载中...</p>}

      <div className="truth-grid">
        {files.map((f) => (
          <div key={f.key} className="truth-panel">
            <h3>{f.label}</h3>
            <p className="truth-desc">{f.desc}</p>
            <pre className="truth-content">
              {(truth as Record<string, string>)[f.key] || '(空)'}
            </pre>
          </div>
        ))}
      </div>

      <style>{`
        .truth-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 16px;
          margin-top: 16px;
        }
        .truth-panel {
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 16px;
          max-height: 500px;
          overflow-y: auto;
        }
        .truth-desc {
          font-size: 12px;
          color: #888;
          margin-bottom: 8px;
        }
        .truth-content {
          white-space: pre-wrap;
          word-break: break-word;
          font-size: 13px;
          line-height: 1.6;
          margin-top: 8px;
        }
      `}</style>
    </div>
  )
}
