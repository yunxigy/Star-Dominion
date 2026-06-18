import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useNovelStore } from './store/novelStore'
import AppLayout from './components/layout/AppLayout'
import DashboardPage from './pages/DashboardPage'
import ChaptersPage from './pages/ChaptersPage'
import WorldviewPage from './pages/WorldviewPage'
import ForeshadowingPage from './pages/ForeshadowingPage'
import AIPage from './pages/AIPage'
import WorkflowPage from './pages/WorkflowPage'
import ToolsPage from './pages/ToolsPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const loadNovels = useNovelStore((s) => s.loadNovels)

  useEffect(() => {
    loadNovels()
  }, [loadNovels])

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="chapters" element={<ChaptersPage />} />
        <Route path="worldview" element={<WorldviewPage />} />
        <Route path="foreshadowing" element={<ForeshadowingPage />} />
        <Route path="ai" element={<AIPage />} />
        <Route path="workflow" element={<WorkflowPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="settings" element={<SettingsPage />} />

        {/* 旧路由兼容重定向 */}
        <Route path="chat" element={<Navigate to="/ai" replace />} />
        <Route path="auto-write" element={<Navigate to="/ai" replace />} />
        <Route path="style" element={<Navigate to="/ai" replace />} />
        <Route path="outline" element={<Navigate to="/chapters" replace />} />
        <Route path="characters" element={<Navigate to="/worldview" replace />} />
        <Route path="graph" element={<Navigate to="/worldview" replace />} />
        <Route path="world" element={<Navigate to="/worldview" replace />} />
        <Route path="truth" element={<Navigate to="/worldview" replace />} />
        <Route path="stats" element={<Navigate to="/dashboard" replace />} />
        <Route path="search" element={<Navigate to="/tools" replace />} />
        <Route path="export" element={<Navigate to="/tools" replace />} />
        <Route path="history" element={<Navigate to="/chapters" replace />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
