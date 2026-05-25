import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import * as Icons from 'lucide-react';
import { CATEGORIES, TOOLS, getToolsByCategory } from '../tools/registry';
import { useToolRunner } from '../components/ToolRunner';
import { ProjectList } from '../components/ProjectList';
import { PlanSection } from '../components/PlanSection';
import { VitsModal } from '../components/VitsModal';
import { MediaStatsModal } from '../components/MediaStatsModal';
import { GachaModal } from '../components/GachaModal';
import { NovelModal } from '../components/NovelModal';
import { GalleryModal } from '../components/GalleryModal';
import { AeModal } from '../components/AeModal';
import { ReactionTestModal } from '../components/ReactionTestModal';

export const ToolboxPage: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState<string>(CATEGORIES[0].id);
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { openTool } = useToolRunner();

  const [isVitsOpen, setIsVitsOpen] = useState(false);
  const [isMediaStatsOpen, setIsMediaStatsOpen] = useState(false);
  const [isGachaOpen, setIsGachaOpen] = useState(false);
  const [isNovelOpen, setIsNovelOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isAeOpen, setIsAeOpen] = useState(false);
  const [isReactionOpen, setIsReactionOpen] = useState(false);

  const filteredTools = useMemo(() => {
    if (!search.trim()) return getToolsByCategory(activeCategory);
    const q = search.toLowerCase();
    return TOOLS.filter(t =>
      t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [activeCategory, search]);

  const displayTools = search.trim() ? filteredTools : getToolsByCategory(activeCategory);
  const activeCat = CATEGORIES.find(c => c.id === activeCategory)!;

  return (
    <>
      {/* Mobile header */}
      <div className="lg:hidden flex items-center gap-3 mb-4">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg glass-card text-slate-300"
        >
          <Icons.Menu className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold text-white">在线工具箱</h1>
      </div>

      <div className="flex gap-6 min-h-[70vh]">
        {/* Sidebar */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-40 w-64 lg:w-56 xl:w-64
          glass-sidebar rounded-2xl p-4 flex flex-col
          transform transition-transform duration-300
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          {/* Search */}
          <div className="relative mb-4">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="搜索工具..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/8 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>

          {/* Category list */}
          <nav className="flex-1 space-y-1 overflow-y-auto">
            {CATEGORIES.map(cat => {
              const CatIcon = (Icons as any)[cat.icon] || Icons.Star;
              const count = getToolsByCategory(cat.id).length;
              const isActive = cat.id === activeCategory && !search.trim();
              return (
                <button
                  key={cat.id}
                  onClick={() => { setActiveCategory(cat.id); setSearch(''); setSidebarOpen(false); }}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200
                    ${isActive
                      ? 'bg-white/10 text-white shadow-lg shadow-black/10'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}
                  `}
                >
                  <div className={`p-1.5 rounded-lg bg-gradient-to-br ${cat.gradient} ${isActive ? 'shadow-md' : 'opacity-70'}`}>
                    <CatIcon className="w-4 h-4 text-white" />
                  </div>
                  <span className="flex-1 text-left font-medium">{cat.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-500'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Sidebar footer */}
          <div className="mt-4 pt-3 border-t border-white/5 text-xs text-slate-600 text-center">
            共 {TOOLS.length} 个工具
          </div>
        </aside>

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-white hidden lg:block">在线工具箱</h1>
            <p className="text-slate-400 text-sm mt-1 hidden lg:block">纯前端处理，数据不上传服务器</p>
          </div>

          {/* Search result indicator */}
          {search.trim() && (
            <div className="mb-4 flex items-center gap-2 text-sm text-slate-400">
              <Icons.Search className="w-4 h-4" />
              <span>搜索 "{search}" 找到 {displayTools.length} 个工具</span>
              <button onClick={() => setSearch('')} className="text-violet-400 hover:text-violet-300 ml-2">清除</button>
            </div>
          )}

          {/* Tool grid */}
          {displayTools.length === 0 ? (
            <div className="text-center py-20">
              <Icons.SearchX className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500">没有找到匹配的工具</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {displayTools.map((tool, index) => {
                const ToolIcon = (Icons as any)[tool.icon] || Icons.Star;
                return (
                  <motion.button
                    key={tool.id}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03, duration: 0.3 }}
                    onClick={() => openTool(tool.id)}
                    className="w-full text-left group glass-card rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl bg-gradient-to-br ${tool.gradient} shadow-lg shrink-0`}>
                        <ToolIcon className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-white group-hover:text-violet-200 transition-colors truncate">
                          {tool.name}
                        </h3>
                        <p className="text-sm text-slate-400 mt-0.5 line-clamp-2">
                          {tool.description}
                        </p>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Project sections below */}
      <div className="mt-16">
        <ProjectList
          onOpenVits={() => setIsVitsOpen(true)}
          onOpenMediaStats={() => setIsMediaStatsOpen(true)}
          onOpenGacha={() => setIsGachaOpen(true)}
          onOpenNovel={() => setIsNovelOpen(true)}
          onOpenReaction={() => setIsReactionOpen(true)}
        />
      </div>

      <PlanSection
        onOpenVits={() => setIsVitsOpen(true)}
        onOpenGallery={() => setIsGalleryOpen(true)}
        onOpenAe={() => setIsAeOpen(true)}
      />

      {isVitsOpen && <VitsModal isOpen={isVitsOpen} onClose={() => setIsVitsOpen(false)} />}
      {isMediaStatsOpen && <MediaStatsModal isOpen={isMediaStatsOpen} onClose={() => setIsMediaStatsOpen(false)} />}
      {isGachaOpen && <GachaModal isOpen={isGachaOpen} onClose={() => setIsGachaOpen(false)} />}
      {isNovelOpen && <NovelModal isOpen={isNovelOpen} onClose={() => setIsNovelOpen(false)} />}
      {isGalleryOpen && <GalleryModal isOpen={isGalleryOpen} onClose={() => setIsGalleryOpen(false)} />}
      {isAeOpen && <AeModal isOpen={isAeOpen} onClose={() => setIsAeOpen(false)} />}
      {isReactionOpen && <ReactionTestModal isOpen={isReactionOpen} onClose={() => setIsReactionOpen(false)} />}
    </>
  );
};

export default ToolboxPage;
