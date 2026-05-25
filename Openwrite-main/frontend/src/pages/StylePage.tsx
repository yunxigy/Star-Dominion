import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import api from '../api/client'

export default function StylePage() {
  const { currentNovelId } = useNovelStore()
  const [style, setStyle] = useState({ composed: '', fingerprint: {}, manifest: '' })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!currentNovelId) return
    setLoading(true)
    api.get(`/novels/${currentNovelId}/style`)
      .then(({ data }) => setStyle(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [currentNovelId])

  return (
    <div className="page style-page">
      <h1>风格系统</h1>
      <div className="help-box">
        <p>风格系统控制 AI 写作的语言风格。包含三层：</p>
        <ul>
          <li><strong>组合风格</strong>（最终给 Writer 参考的风格说明书）</li>
          <li><strong>风格指纹</strong>（叙述声音、语言习惯、节奏等结构化数据）</li>
          <li><strong>风格清单</strong>（从参考文章中提取的可用风格规则）</li>
        </ul>
        <p>要添加风格参考，请在<strong>对话</strong>页面让 Goethe 执行"风格提取"，或使用 CLI 命令 <code>openwrite style extract</code>。</p>
      </div>
      {loading && <p>加载中...</p>}

      <div className="style-section">
        <h2>组合风格（Writer 参考）</h2>
        <pre className="style-content">{style.composed || '(空)'}</pre>
      </div>

      <div className="style-section">
        <h2>风格指纹</h2>
        <pre className="style-content">
          {Object.keys(style.fingerprint).length > 0
            ? JSON.stringify(style.fingerprint, null, 2)
            : '(空)'}
        </pre>
      </div>

      {style.manifest && (
        <div className="style-section">
          <h2>风格清单</h2>
          <pre className="style-content">{style.manifest}</pre>
        </div>
      )}

      <style>{`
        .style-section {
          margin-top: 24px;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 16px;
        }
        .style-content {
          white-space: pre-wrap;
          word-break: break-word;
          font-size: 13px;
          line-height: 1.6;
          max-height: 400px;
          overflow-y: auto;
          margin-top: 8px;
        }
      `}</style>
    </div>
  )
}
