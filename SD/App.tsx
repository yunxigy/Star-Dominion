import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { PageLayout } from './layouts/PageLayout';
import { ToolRunnerProvider } from './components/ToolRunner';
import { HomePage } from './pages/HomePage';
import { StarAlliancePage } from './pages/StarAlliancePage';
import { ToolboxPage } from './pages/ToolboxPage';
import { TranslationPage } from './pages/TranslationPage';
import { PoemPage } from './pages/PoemPage';
import { Stm32Page } from './pages/Stm32Page';
import { AIAgentPage } from './pages/AIAgentPage';
import { PlagiarismPage } from './pages/PlagiarismPage';

export default function App() {
  return (
    <BrowserRouter>
      <ToolRunnerProvider>
        <Routes>
          <Route path="/" element={<PageLayout><HomePage /></PageLayout>} />
          <Route path="/zm" element={<PageLayout><StarAlliancePage /></PageLayout>} />
          <Route path="/gj" element={<PageLayout><ToolboxPage /></PageLayout>} />
          <Route path="/fy" element={<PageLayout><TranslationPage /></PageLayout>} />
          <Route path="/hs" element={<PageLayout><PoemPage /></PageLayout>} />
          <Route path="/bp" element={<PageLayout fullScreen><Stm32Page /></PageLayout>} />
          <Route path="/ai" element={<PageLayout fullScreen><AIAgentPage /></PageLayout>} />
          <Route path="/lwc" element={<PageLayout><PlagiarismPage /></PageLayout>} />
        </Routes>
      </ToolRunnerProvider>
    </BrowserRouter>
  );
}
