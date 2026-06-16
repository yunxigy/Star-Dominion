import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useNovelStore } from './store/novelStore'
import AppLayout from './components/layout/AppLayout'
import DashboardPage from './pages/DashboardPage'
import ChatPage from './pages/ChatPage'
import ChaptersPage from './pages/ChaptersPage'
import OutlinePage from './pages/OutlinePage'
import CharactersPage from './pages/CharactersPage'
import WorldPage from './pages/WorldPage'
import TruthFilesPage from './pages/TruthFilesPage'
import ForeshadowingPage from './pages/ForeshadowingPage'
import StylePage from './pages/StylePage'
import WorkflowPage from './pages/WorkflowPage'
import SettingsPage from './pages/SettingsPage'
import AutoWritePage from './pages/AutoWritePage'
import ExportPage from './pages/ExportPage'
import StatsPage from './pages/StatsPage'
import SearchPage from './pages/SearchPage'
import GraphPage from './pages/GraphPage'
import HistoryPage from './pages/HistoryPage'
import ToolsPage from './pages/ToolsPage'

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
        <Route path="chat" element={<ChatPage />} />
        <Route path="chapters" element={<ChaptersPage />} />
        <Route path="outline" element={<OutlinePage />} />
        <Route path="characters" element={<CharactersPage />} />
        <Route path="world" element={<WorldPage />} />
        <Route path="truth" element={<TruthFilesPage />} />
        <Route path="foreshadowing" element={<ForeshadowingPage />} />
        <Route path="style" element={<StylePage />} />
        <Route path="workflow" element={<WorkflowPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="auto-write" element={<AutoWritePage />} />
        <Route path="export" element={<ExportPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
