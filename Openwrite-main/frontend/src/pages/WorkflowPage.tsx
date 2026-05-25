import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'

interface ChapterWorkflow {
  chapter_id: string
  title?: string
  stage: string
  progress?: number
  steps?: { name: string; status: string; completed_at?: string }[]
}

const chapterStages = [
  { key: 'context', label: '组装上下文', icon: '📋' },
  { key: 'writing', label: '写作', icon: '✍️' },
  { key: 'review', label: '审查', icon: '🔍' },
  { key: 'confirm', label: '确认', icon: '✅' },
  { key: 'style', label: '风格', icon: '🎨' },
  { key: 'compress', label: '压缩', icon: '📦' },
]

function ChapterWorkflowCard({ chapter }: { chapter: ChapterWorkflow }) {
  const currentStageIdx = chapterStages.findIndex((s) => s.key === chapter.stage)

  return (
    <div className="chapter-workflow-card">
      <div className="chapter-header">
        <div className="chapter-info">
          <span className="chapter-id">{chapter.chapter_id}</span>
          {chapter.title && <span className="chapter-title">{chapter.title}</span>}
        </div>
        <span className="chapter-stage-badge">{chapter.stage}</span>
      </div>
      <div className="chapter-steps">
        {chapterStages.map((stage, idx) => {
          const step = chapter.steps?.find((s) => s.name === stage.key)
          const status = step?.status || (idx < currentStageIdx ? 'completed' : idx === currentStageIdx ? 'in_progress' : 'pending')
          return (
            <div
              key={stage.key}
              className={`chapter-step ${status}`}
              title={`${stage.label}: ${status}`}
            >
              <div className="step-icon">{stage.icon}</div>
              <div className="step-label">{stage.label}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function WorkflowPage() {
  const { currentNovelId, status } = useNovelStore()
  const [workflow, setWorkflow] = useState<{ stage?: string; chapters?: ChapterWorkflow[] }>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/workflow`)
      .then(({ data }) => setWorkflow(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [currentNovelId, status])

  const stages = [
    { key: 'DISCOVERY', label: '探索期', desc: '收集灵感、整理想法' },
    { key: 'FOUNDATION', label: '奠基期', desc: '确认基础设定和人物' },
    { key: 'ROLLING_OUTLINE', label: '滚动大纲', desc: '生成和确认大纲' },
    { key: 'CHAPTER_PREFLIGHT', label: '章节预检', desc: '写章前的上下文准备' },
    { key: 'DRAFTING', label: '写作中', desc: '正在生成章节正文' },
    { key: 'REVIEW_AND_REVISE', label: '审查修订', desc: '质量检查和修改' },
    { key: 'SETTLEMENT', label: '状态结算', desc: '更新真相文件和状态' },
    { key: 'MILESTONE_REVIEW', label: '里程碑审查', desc: '阶段性整体回顾' },
  ]

  const currentStage = workflow.stage || ''
  const currentIdx = stages.findIndex((s) => s.key === currentStage)

  return (
    <div className="page workflow-page">
      <h1>工作流</h1>
      <div className="help-box">
        <p>工作流展示了书的整体写作进度。从左到右依次经过 8 个阶段：探索期 → 奠基期 → 滚动大纲 → 章节预检 → 写作中 → 审查修订 → 状态结算 → 里程碑审查。黄色高亮表示当前所在阶段。每个章节也有独立的 6 步工作流（组装上下文 → 写作 → 审查 → 确认 → 风格 → 压缩），显示在下方列表中。</p>
      </div>
      {loading && <p>加载中...</p>}

      <div className="workflow-stages">
        {stages.map((s, i) => (
          <div
            key={s.key}
            className={`workflow-stage ${i === currentIdx ? 'current' : i < currentIdx ? 'done' : ''}`}
            title={s.desc}
          >
            <div className="stage-dot" />
            <span className="stage-label">{s.label}</span>
          </div>
        ))}
      </div>

      {workflow.chapters && workflow.chapters.length > 0 && (
        <div className="workflow-chapters">
          <h2>章节工作流 ({workflow.chapters.length})</h2>
          <div className="chapters-grid">
            {workflow.chapters.map((chapter) => (
              <ChapterWorkflowCard key={chapter.chapter_id} chapter={chapter} />
            ))}
          </div>
        </div>
      )}

      <style>{`
        .workflow-stages {
          display: flex;
          align-items: center;
          gap: 0;
          margin: 24px 0;
          padding: 20px;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          overflow-x: auto;
        }
        .workflow-stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          flex: 1;
          position: relative;
        }
        .workflow-stage:not(:last-child)::after {
          content: '';
          position: absolute;
          top: 10px;
          left: 50%;
          width: 100%;
          height: 2px;
          background: #e0e0e0;
          z-index: 0;
        }
        .workflow-stage.done:not(:last-child)::after { background: #7c8aff; }
        .stage-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #e0e0e0;
          z-index: 1;
        }
        .workflow-stage.done .stage-dot { background: #7c8aff; }
        .workflow-stage.current .stage-dot {
          background: #ffd700;
          box-shadow: 0 0 0 4px rgba(255, 215, 0, 0.3);
        }
        .stage-label {
          font-size: 11px;
          text-align: center;
          color: #888;
          max-width: 80px;
        }
        .workflow-stage.current .stage-label { color: #333; font-weight: 600; }
        .workflow-chapters {
          margin-top: 24px;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 16px;
        }
        .workflow-chapters h2 {
          margin: 0 0 16px;
        }
        .chapters-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 12px;
        }
        .chapter-workflow-card {
          background: #fafafa;
          border-radius: 6px;
          border: 1px solid #e0e0e0;
          padding: 12px;
        }
        .chapter-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .chapter-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .chapter-id {
          font-size: 12px;
          color: #888;
        }
        .chapter-title {
          font-size: 14px;
          font-weight: 600;
        }
        .chapter-stage-badge {
          font-size: 11px;
          padding: 2px 8px;
          background: #e8eaff;
          border-radius: 10px;
          color: #5a6ae0;
        }
        .chapter-steps {
          display: flex;
          gap: 4px;
        }
        .chapter-step {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 6px 4px;
          border-radius: 4px;
          background: #f0f0f0;
          transition: background 0.15s;
        }
        .chapter-step.completed {
          background: #d1fae5;
        }
        .chapter-step.in_progress {
          background: #fef3c7;
          box-shadow: 0 0 0 2px rgba(255, 215, 0, 0.3);
        }
        .chapter-step.failed {
          background: #fee2e2;
        }
        .step-icon {
          font-size: 14px;
        }
        .step-label {
          font-size: 9px;
          text-align: center;
          color: #666;
          line-height: 1.2;
        }
      `}</style>
    </div>
  )
}
