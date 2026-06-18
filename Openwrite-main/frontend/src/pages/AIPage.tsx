import { useState } from 'react'
import ChatPage from './ChatPage'
import AutoWritePage from './AutoWritePage'
import StylePage from './StylePage'

type Tab = 'chat' | 'auto-write' | 'style'

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'chat', label: '对话', icon: '💬' },
  { key: 'auto-write', label: '自动写作', icon: '🤖' },
  { key: 'style', label: '风格', icon: '🎨' },
]

export default function AIPage() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')

  return (
    <div className="page ai-page">
      <div className="tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === 'chat' && <ChatPage />}
        {activeTab === 'auto-write' && <AutoWritePage />}
        {activeTab === 'style' && <StylePage />}
      </div>

      <style>{`
        .ai-page { padding: 0; }
        .tab-bar {
          display: flex; gap: 4px; padding: 12px 0;
          border-bottom: 1px solid #e0e0e0; margin-bottom: 16px;
        }
        .tab-btn {
          padding: 6px 14px; border: none; background: none;
          border-radius: 6px; font-size: 13px; cursor: pointer;
          color: #666; transition: all 0.1s;
        }
        .tab-btn:hover { background: #f0f0f0; }
        .tab-btn.active { background: #7c8aff; color: #fff; }
        .tab-content { min-height: 60vh; }
      `}</style>
    </div>
  )
}
