import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ToolRunnerProvider } from './components/ToolRunner';
import { HomePage } from './pages/HomePage';
import { ToolboxPage } from './pages/ToolboxPage';
import { TranslationPage } from './pages/TranslationPage';
import { Stm32Page } from './pages/Stm32Page';
import { AIAgentPage } from './pages/AIAgentPage';
import { ShouAnRenPage } from './pages/ShouAnRenPage';
import { LoginPage } from './pages/LoginPage';
import { CategoryPage } from './pages/CategoryPage';
import { ReportsPage } from './pages/ReportsPage';
import { GitHubReportsPage } from './pages/GitHubReportsPage';
import ToolWindow from './components/ToolWindow';

export default function App() {
  return (
    <BrowserRouter>
      <ToolRunnerProvider>
        <Routes>
          {/* 主应用布局 */}
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="/gj" element={<ToolboxPage />} />
            <Route path="/fy" element={<TranslationPage />} />
            <Route path="/bp" element={<Stm32Page />} />
            <Route path="/ai" element={<AIAgentPage />} />
            <Route path="/wuwa" element={<ShouAnRenPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/github" element={<GitHubReportsPage />} />
            <Route path="/auth/login" element={<LoginPage />} />
          </Route>

          {/* 分类专题页 */}
          <Route path="/category/:categoryId" element={<CategoryPage />} />

          {/* 工具窗口（新窗口打开） */}
          <Route path="/tool/:toolId" element={<ToolWindow />} />
        </Routes>
      </ToolRunnerProvider>
    </BrowserRouter>
  );
}
