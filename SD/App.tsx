import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ToolRunnerProvider } from './components/ToolRunner';
import { HomePage } from './pages/HomePage';
import MiniToolsPage from './pages/MiniToolsPage';
import { ScrollToTop } from './layouts/ScrollToTop';
import { getMiniMode } from './lib/miniMode';

const ToolboxPage = lazy(() => import('./pages/ToolboxPage').then(module => ({ default: module.ToolboxPage })));
const TranslationPage = lazy(() => import('./pages/TranslationPage').then(module => ({ default: module.TranslationPage })));
const Stm32Page = lazy(() => import('@stm32-page').then(module => ({ default: module.Stm32Page })));
const Stm32Window = lazy(() => import('@stm32-window'));
const AIAgentPage = lazy(() => import('./pages/AIAgentPage').then(module => ({ default: module.AIAgentPage })));
const ShouAnRenPage = lazy(() => import('./pages/ShouAnRenPage').then(module => ({ default: module.ShouAnRenPage })));
const LoginPage = lazy(() => import('@login-page').then(module => ({ default: module.LoginPage })));
const CategoryPage = lazy(() => import('./pages/CategoryPage').then(module => ({ default: module.CategoryPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(module => ({ default: module.ReportsPage })));
const GitHubReportsPage = lazy(() => import('./pages/GitHubReportsPage').then(module => ({ default: module.GitHubReportsPage })));
const AIReportsPage = lazy(() => import('./pages/AIReportsPage').then(module => ({ default: module.AIReportsPage })));
const NewsEventsPage = lazy(() => import('./pages/NewsEventsPage').then(module => ({ default: module.NewsEventsPage })));
const AIBriefingPage = lazy(() => import('./pages/AIBriefingPage').then(module => ({ default: module.AIBriefingPage })));
const ToolWindow = lazy(() => import('./components/ToolWindow'));
const GamesPage = lazy(() => import('./pages/GamesPage').then(module => ({ default: module.GamesPage })));
const GamePage = lazy(() => import('./pages/GamePage').then(module => ({ default: module.GamePage })));

function MiniModeBlocked({ children }: { children: ReactNode }) {
  return getMiniMode() ? <Navigate replace to="/?mini=1" /> : <>{children}</>;
}

function CategoryEntry() {
  const { categoryId = '' } = useParams();
  return getMiniMode()
    ? <Navigate replace to={`/gj?category=${encodeURIComponent(categoryId)}`} />
    : <CategoryPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ToolRunnerProvider>
        <Suspense fallback={<div role="status" className="p-8 text-center text-[#6d5a47]">页面加载中…</div>}>
          <Routes>
            {/* 主应用布局 */}
            <Route element={<AppLayout />}>
              <Route index element={getMiniMode() ? <MiniToolsPage /> : <HomePage />} />
              <Route path="/gj" element={<ToolboxPage />} />
              <Route path="/fy" element={<TranslationPage />} />
              <Route path="/games" element={<GamesPage />} />
              <Route path="/games/:gameId" element={<GamePage />} />

              {/* 工具详情页沿用主应用壳层，保持左侧工具目录可见 */}
              <Route path="/tool/:toolId" element={<ToolWindow />} />
              <Route path="/bp" element={<MiniModeBlocked><Stm32Page /></MiniModeBlocked>} />
              <Route path="/ai" element={<MiniModeBlocked><AIAgentPage /></MiniModeBlocked>} />
              <Route path="/wuwa" element={<MiniModeBlocked><ShouAnRenPage /></MiniModeBlocked>} />
              <Route path="/reports" element={<MiniModeBlocked><ReportsPage /></MiniModeBlocked>} />
              <Route path="/reports/github" element={<MiniModeBlocked><GitHubReportsPage /></MiniModeBlocked>} />
              <Route path="/reports/ai" element={<MiniModeBlocked><AIReportsPage /></MiniModeBlocked>} />
              <Route path="/reports/news" element={<MiniModeBlocked><NewsEventsPage /></MiniModeBlocked>} />
              <Route path="/reports/briefing" element={<MiniModeBlocked><AIBriefingPage /></MiniModeBlocked>} />
              <Route path="/auth/login" element={<MiniModeBlocked><LoginPage /></MiniModeBlocked>} />
            </Route>

            {/* 分类专题页 */}
            <Route path="/category/:categoryId" element={<CategoryEntry />} />

            {/* 独立工作区 */}
            <Route path="/stm32/*" element={<MiniModeBlocked><Stm32Window /></MiniModeBlocked>} />
          </Routes>
        </Suspense>
      </ToolRunnerProvider>
    </BrowserRouter>
  );
}
