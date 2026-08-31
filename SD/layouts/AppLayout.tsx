import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, X, Wrench, Home, Clock, Sparkles, ChevronUp, Gamepad2 } from 'lucide-react';
import { TOOLS } from '../tools/registry';
import { GAME_CATALOG } from '../games/catalog';
import { MouseParticles } from '../components/MouseParticles';
import { AccountMenu } from '../components/AccountMenu';
import { ThemeControl } from '../components/ThemeControl';
import { SidebarCatalog } from './SidebarCatalog';

// 侧边栏时钟组件
const SidebarClock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-soft)]">
      <Clock className="w-3 h-3" />
      <span className="font-mono">
        {time.toLocaleTimeString('zh-CN', { hour12: false })}
      </span>
    </div>
  );
};

// 返回顶部按钮
const BackToTop: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={`back-to-top ${visible ? 'visible' : ''}`}
      title="返回顶部"
    >
      <ChevronUp className="w-5 h-5" />
    </button>
  );
};

export const AppLayout: React.FC = () => {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isHome = location.pathname === '/';
  const isToolDetail = location.pathname.startsWith('/tool/');
  const isGames = location.pathname.startsWith('/games');

  return (
    <div className="min-h-screen mesh-bg">
      <MouseParticles />
      <a href="#main-content" className="skip-link">跳到主要内容</a>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 glass-sidebar px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="打开工具目录"
          aria-expanded={sidebarOpen}
          aria-controls="tool-sidebar"
          className="p-2 rounded-lg bg-[var(--surface-hover)] text-[var(--text-muted)] hover:bg-[var(--surface-active)] hover:text-[var(--text)]"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <Link to="/" className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-[#9a5a28] to-[#5f6f42]">
            <Wrench className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-[var(--text)]">逐梦工具箱</span>
        </Link>
        <ThemeControl compact />
        <SidebarClock />
      </div>

      {/* Sidebar Overlay (Mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 bottom-0 z-40 w-64 lg:w-72
        glass-sidebar flex flex-col
        transform transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `} id="tool-sidebar">
        {/* Logo */}
        <div className="p-4 border-b border-[var(--border)]">
          <Link to="/" className="flex items-center gap-3 group" onClick={() => setSidebarOpen(false)}>
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#9a5a28] to-[#5f6f42] shadow-lg shadow-[#9a5a28]/20 group-hover:shadow-[#9a5a28]/30 transition-shadow">
              <Wrench className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[var(--text)] group-hover:text-[var(--accent-strong)] transition-colors">
                逐梦工具箱
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--accent-strong)]">{TOOLS.length}+ 免费工具</span>
                <Sparkles className="w-3 h-3 text-[var(--accent)]" />
              </div>
            </div>
          </Link>
        </div>

        {/* Home Link */}
        <div className="px-3 mb-1">
          <Link
            to="/"
            onClick={() => setSidebarOpen(false)}
            className={`sidebar-item ${isHome ? 'active' : ''}`}
          >
            <Home className="w-4 h-4" />
            <span className="font-medium">首页</span>
          </Link>
        </div>

        {/* Full tool directory */}
        <SidebarCatalog onNavigate={() => setSidebarOpen(false)} />

        <div className="px-3 pb-2">
          <Link
            to="/games"
            onClick={() => setSidebarOpen(false)}
            aria-current={isGames ? 'page' : undefined}
            className={`sidebar-item ${isGames ? 'active' : ''}`}
          >
            <span className="rounded-lg bg-gradient-to-br from-emerald-600 to-teal-600 p-1.5">
              <Gamepad2 className="h-4 w-4 text-white" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 font-medium">趣味游戏</span>
            <span className="rounded-full bg-[#f1dcc2] px-2 py-0.5 text-xs text-[#6d5a47]">{GAME_CATALOG.length}</span>
          </Link>
        </div>

        <div className="px-3 pb-4">
          <AccountMenu />
        </div>
        <div className="px-3 pb-4">
          <ThemeControl />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)]">
          <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
            <span>共 {TOOLS.length} 个工具</span>
            <SidebarClock />
          </div>
          <p className="text-xs text-[var(--text-soft)] mt-1">本地优先 · 隐私分级</p>
        </div>
      </aside>

      {/* Main Content */}
      <main id="main-content" className="lg:ml-72 pt-16 lg:pt-0 min-h-screen flex flex-col">
        <div className="flex-1 p-4 lg:p-8">
          <Outlet />
        </div>

        {/* Footer (工具详情页使用自己的隐私说明页脚，避免重复) */}
        {!isToolDetail && (
          <footer className="p-4 text-center text-[var(--text-soft)] text-sm border-t border-[var(--border)]">
            <p>&copy; {new Date().getFullYear()} 逐梦工具箱 | All Rights Reserved.</p>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--accent-strong)] transition-colors"
            >
              津ICP备2025041246号-1
            </a>
          </footer>
        )}

        <BackToTop />
      </main>
    </div>
  );
};

export default AppLayout;
