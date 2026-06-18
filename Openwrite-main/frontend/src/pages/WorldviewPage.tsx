import { useState } from 'react'
import CharactersPage from './CharactersPage'
import GraphPage from './GraphPage'
import WorldPage from './WorldPage'
import TruthFilesPage from './TruthFilesPage'

type Tab = 'characters' | 'graph' | 'world' | 'truth'

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: 'characters', label: '角色', icon: '👤' },
  { key: 'graph', label: '关系图', icon: '🕸️' },
  { key: 'world', label: '世界', icon: '🌍' },
  { key: 'truth', label: '真相文件', icon: '📄' },
]

export default function WorldviewPage() {
  const [activeTab, setActiveTab] = useState<Tab>('characters')

  return (
    <div className="page worldview-page">
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
        {activeTab === 'characters' && <CharactersPage embedded />}
        {activeTab === 'graph' && <GraphPage embedded />}
        {activeTab === 'world' && <WorldPage />}
        {activeTab === 'truth' && <TruthFilesPage />}
      </div>

      <style>{`
        .worldview-page { padding: 0; }
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
