import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ToolRunnerProvider } from './components/ToolRunner';
import { HomePage } from './pages/HomePage';
import { ToolboxPage } from './pages/ToolboxPage';
import { TranslationPage } from './pages/TranslationPage';
import { Stm32Page } from './pages/Stm32Page';
import { AIAgentPage } from './pages/AIAgentPage';
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
          </Route>

          {/* 工具窗口（新窗口打开） */}
          <Route path="/tool/:toolId" element={<ToolWindow />} />
        </Routes>
      </ToolRunnerProvider>
    </BrowserRouter>
  );
}
