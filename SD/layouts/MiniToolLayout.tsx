import { ArrowLeft, Wrench } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';

export function MiniToolLayout() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="mini-tool-shell">
      <header className="mini-tool-shell__header">
        <Link to="/" className="mini-tool-shell__brand" aria-label="逐梦工具箱">
          <span className="mini-tool-shell__brand-icon"><Wrench aria-hidden="true" /></span>
          <span>逐梦工具箱</span>
        </Link>
        {!isHome && (
          <Link to="/" className="mini-tool-shell__back" aria-label="返回工具箱">
            <ArrowLeft aria-hidden="true" />
            <span>工具箱</span>
          </Link>
        )}
      </header>
      <main id="main-content" className="mini-tool-shell__main"><Outlet /></main>
      <footer className="mini-tool-shell__footer">本地优先 · 工具结果留在当前设备</footer>
    </div>
  );
}

export default MiniToolLayout;
