import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ToolRunnerProvider } from './components/ToolRunner';
import { HomePage } from './pages/HomePage';
import { ScrollToTop } from './layouts/ScrollToTop';

const ToolboxPage = lazy(() => import('./pages/ToolboxPage').then(module => ({ default: module.ToolboxPage })));
const TranslationPage = lazy(() => import('./pages/TranslationPage').then(module => ({ default: module.TranslationPage })));
const Stm32Page = lazy(() => import('./pages/Stm32Page').then(module => ({ default: module.Stm32Page })));
const Stm32Window = lazy(() => import('./pages/Stm32Window'));
const AIAgentPage = lazy(() => import('./pages/AIAgentPage').then(module => ({ default: module.AIAgentPage })));
const ShouAnRenPage = lazy(() => import('./pages/ShouAnRenPage').then(module => ({ default: module.ShouAnRenPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })));
const CategoryPage = lazy(() => import('./pages/CategoryPage').then(module => ({ default: module.CategoryPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(module => ({ default: module.ReportsPage })));
const GitHubReportsPage = lazy(() => import('./pages/GitHubReportsPage').then(module => ({ default: module.GitHubReportsPage })));
const AIReportsPage = lazy(() => import('./pages/AIReportsPage').then(module => ({ default: module.AIReportsPage })));
const NewsEventsPage = lazy(() => import('./pages/NewsEventsPage').then(module => ({ default: module.NewsEventsPage })));
const AIBriefingPage = lazy(() => import('./pages/AIBriefingPage').then(module => ({ default: module.AIBriefingPage })));
const ToolWindow = lazy(() => import('./components/ToolWindow'));

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ToolRunnerProvider>
        <Suspense fallback={<div role="status" className="p-8 text-center text-[#6d5a47]">页面加载中…</div>}>
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
              <Route path="/reports/ai" element={<AIReportsPage />} />
              <Route path="/reports/news" element={<NewsEventsPage />} />
              <Route path="/reports/briefing" element={<AIBriefingPage />} />
              <Route path="/auth/login" element={<LoginPage />} />

              {/* 工具详情页沿用主应用壳层，保持左侧工具目录可见 */}
              <Route path="/tool/:toolId" element={<ToolWindow />} />
            </Route>

            {/* 分类专题页 */}
            <Route path="/category/:categoryId" element={<CategoryPage />} />

            {/* 独立工作区 */}
            <Route path="/stm32/*" element={<Stm32Window />} />
          </Routes>
        </Suspense>
      </ToolRunnerProvider>
    </BrowserRouter>
  );
}
