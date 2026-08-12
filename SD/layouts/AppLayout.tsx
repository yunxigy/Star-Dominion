import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, Search, Wrench, Home, ArrowRight, Clock, Sparkles, ChevronUp } from 'lucide-react';
import { CATEGORIES, TOOLS, getToolsByCategory } from '../tools/registry';
import { getIcon } from '../lib/iconMap';
import { MouseParticles } from '../components/MouseParticles';
import { AccountMenu } from '../components/AccountMenu';
import { PROJECT_LINKS } from '../lib/projectLinks';
import { useAuth } from '../context/AuthContext';

// 侧边栏时钟组件
const SidebarClock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-[#8b735c]">
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
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const isHome = location.pathname === '/';

  // Filter categories based on search
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return CATEGORIES;
    const q = searchQuery.toLowerCase();
    return CATEGORIES.filter(cat =>
      cat.name.toLowerCase().includes(q) ||
      cat.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleCategoryClick = (categoryId: string) => {
    navigate(`/gj?category=${categoryId}`);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen mesh-bg text-[#2f241b]">
      <MouseParticles />

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 glass-sidebar px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg bg-[#f1dcc2] text-[#6d5a47] hover:bg-[#ead0ad] hover:text-[#2f241b]"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <Link to="/" className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-[#9a5a28] to-[#5f6f42]">
            <Wrench className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-[#2f241b]">逐梦工具箱</span>
        </Link>
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
      `}>
        {/* Logo */}
        <div className="p-4 border-b border-[#dcc2a3]">
          <Link to="/" className="flex items-center gap-3 group" onClick={() => setSidebarOpen(false)}>
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#9a5a28] to-[#5f6f42] shadow-lg shadow-[#9a5a28]/20 group-hover:shadow-[#9a5a28]/30 transition-shadow">
              <Wrench className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#2f241b] group-hover:text-[#6f3714] transition-colors">
                逐梦工具箱
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#8a4b1f]">{TOOLS.length}+ 免费工具</span>
                <Sparkles className="w-3 h-3 text-[#9a5a28]" />
              </div>
            </div>
          </Link>
        </div>

        {/* Search */}
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b735c]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索分类..."
              className="w-full pl-9 pr-3 py-3 rounded-xl bg-[#fff4e6] border border-[#d8b58e] text-sm text-[#2f241b] placeholder-[#8b735c] focus:outline-none focus:border-[#9a5a28] transition-colors"
            />
          </div>
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

        {/* Categories */}
        <div className="px-3 mb-2">
          <div className="text-xs text-[#8b735c] uppercase tracking-widest px-3 py-2 font-semibold">
            工具分类
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 space-y-1 scrollbar-thin">
          {filteredCategories.map(cat => {
            const CatIcon = getIcon(cat.icon);
            const count = getToolsByCategory(cat.id).length;
            const isActive = location.pathname === '/gj' && new URLSearchParams(location.search).get('category') === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => handleCategoryClick(cat.id)}
                className={`sidebar-item w-full ${isActive ? 'active' : ''}`}
              >
                <div className={`p-1.5 rounded-lg bg-gradient-to-br ${cat.gradient} ${isActive ? 'shadow-md shadow-emerald-500/25' : 'opacity-80'}`}>
                  <CatIcon className="w-4 h-4 text-white" />
                </div>
                <span className="flex-1 text-left font-medium">{cat.name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#f1dcc2] text-[#6d5a47]">
                  {count}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Project Links */}
        <div className="px-3 mt-4 mb-2">
          <div className="text-xs text-[#8b735c] uppercase tracking-widest px-3 py-2 font-semibold">
            项目作品
          </div>
        </div>
        <div className="px-3 space-y-1 mb-4">
          {PROJECT_LINKS.map(project => {
            const ProjectIcon = getIcon(project.icon);
            const isActive = location.pathname === project.path;
            const content = (
              <>
                <ProjectIcon className="w-4 h-4" />
                <span className="flex-1 font-medium">{project.name}</span>
                <ArrowRight className="w-3 h-3 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </>
            );
            const className = `sidebar-item ${isActive ? 'active' : ''}`;
            return project.external ? (
              <a
                key={project.path}
                href={project.path}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  setSidebarOpen(false);
                  if (project.requiresAuth && !authLoading && !user) {
                    event.preventDefault();
                    navigate(`/auth/login?next=${encodeURIComponent(project.path)}`);
                  }
                }}
                className={className}
              >
                {content}
              </a>
            ) : (
              <Link
                key={project.path}
                to={project.path}
                onClick={() => setSidebarOpen(false)}
                className={className}
              >
                {content}
              </Link>
            );
          })}
        </div>

        <div className="px-3 pb-4">
          <AccountMenu />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#dcc2a3]">
          <div className="flex items-center justify-between text-sm text-[#6d5a47]">
            <span>共 {TOOLS.length} 个工具</span>
            <SidebarClock />
          </div>
          <p className="text-xs text-[#8b735c] mt-1">本地优先 · 隐私分级</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-72 pt-16 lg:pt-0 min-h-screen flex flex-col">
        <div className="flex-1 p-4 lg:p-8">
          <Outlet />
        </div>

        {/* Footer */}
        <footer className="p-4 text-center text-[#8b735c] text-sm border-t border-[#dcc2a3]">
          <p>&copy; {new Date().getFullYear()} 逐梦工具箱 | All Rights Reserved.</p>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#8a4b1f] transition-colors"
          >
            津ICP备2025041246号-1
          </a>
        </footer>

        <BackToTop />
      </main>
    </div>
  );
};

export default AppLayout;
