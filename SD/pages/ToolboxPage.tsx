import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, SearchX, Filter } from 'lucide-react';
import { getIcon } from '../lib/iconMap';
import { CATEGORIES, TOOLS, getToolsByCategory } from '../tools/registry';
import { useToolRunner } from '../components/ToolRunner';

export const ToolboxPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { openTool } = useToolRunner();

  // Handle URL params for search and category
  useEffect(() => {
    const searchQuery = searchParams.get('search');
    const categoryQuery = searchParams.get('category');
    if (searchQuery) {
      setSearch(searchQuery);
    }
    if (categoryQuery && CATEGORIES.find(c => c.id === categoryQuery)) {
      setActiveCategory(categoryQuery);
    }
  }, [searchParams]);

  const displayTools = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return TOOLS.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q)))
      );
    }
    if (activeCategory) {
      return getToolsByCategory(activeCategory);
    }
    return TOOLS;
  }, [activeCategory, search]);

  const activeCatName = activeCategory
    ? CATEGORIES.find(c => c.id === activeCategory)?.name
    : '全部工具';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">
          {search.trim() ? `搜索: ${search}` : activeCatName}
        </h1>
        <p className="text-slate-400 text-base mt-2">
          {search.trim()
            ? `找到 ${displayTools.length} 个工具`
            : `共 ${displayTools.length} 个工具 · 大部分工具纯前端处理`
          }
        </p>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1 search-bar-enhanced">
          <Search className="search-icon absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="搜索工具..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-xl text-white placeholder-slate-500 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <select
            value={activeCategory || ''}
            onChange={(e) => setActiveCategory(e.target.value || null)}
            className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer"
          >
            <option value="">全部分类</option>
            {CATEGORIES.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Category Tags */}
      {!search.trim() && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-4 py-2 rounded-xl text-sm transition-all ${
              !activeCategory
                ? 'bg-white/10 text-white border border-white/20'
                : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
            }`}
          >
            全部
          </button>
          {CATEGORIES.map(cat => {
            const CatIcon = getIcon(cat.icon);
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-all ${
                  activeCategory === cat.id
                    ? 'bg-white/10 text-white border border-white/20'
                    : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                }`}
              >
                <CatIcon className="w-4 h-4" />
                {cat.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Tool Grid */}
      {displayTools.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <SearchX className="w-7 h-7 text-emerald-400/50" />
          </div>
          <h3>没有找到匹配的工具</h3>
          <p>尝试其他关键词或分类</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {displayTools.map((tool, index) => {
            const ToolIcon = getIcon(tool.icon);
            return (
              <motion.button
                key={tool.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.02, 0.5), duration: 0.3 }}
                onClick={() => openTool(tool.id)}
                className="w-full text-left group tool-card-enhanced glass-card rounded-2xl p-6"
              >
                <div className="flex items-start gap-4">
                  <div className={`tool-icon p-3 rounded-xl bg-gradient-to-br ${tool.gradient} shadow-lg shrink-0`}>
                    <ToolIcon className="w-6 h-6 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="tool-name text-lg font-semibold text-white group-hover:text-emerald-300 transition-colors truncate">
                        {tool.name}
                      </h3>
                      {tool.privacy === 'third-party-api' && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">API</span>
                      )}
                      {tool.privacy === 'backend-upload' && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-red-500/20 text-red-400 border border-red-500/30">上传</span>
                      )}
                      {tool.status === 'beta' && (
                        <span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">Beta</span>
                      )}
                    </div>
                    <p className="text-base text-slate-400 mt-2 line-clamp-2">
                      {tool.description}
                    </p>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* Ad placeholder */}
      <div id="ad-tools-inline" className="mt-8 text-center">
        {/* 广告位 */}
      </div>
    </div>
  );
};

export default ToolboxPage;
