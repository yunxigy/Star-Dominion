import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, SearchX, Filter } from 'lucide-react';
import { getIcon } from '../lib/iconMap';
import { CATEGORIES, TOOLS, getToolsByCategory } from '../tools/registry';
import { useToolRunner } from '../components/ToolRunner';
import { AdSlot } from '../components/AdSlot';
import { getRecentTools, getFavoriteTools, toggleFavorite, isFavorite } from '../lib/userTools';

export const ToolboxPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [favRefresh, setFavRefresh] = useState(0);
  const { openTool } = useToolRunner();

  const recentTools = useMemo(() => {
    const ids = getRecentTools();
    return ids.map(id => TOOLS.find(t => t.id === id)).filter(Boolean);
  }, []);

  const favoriteTools = useMemo(() => {
    const ids = getFavoriteTools();
    return ids.map(id => TOOLS.find(t => t.id === id)).filter(Boolean);
  }, [favRefresh]);

  const handleToggleFav = (e: React.MouseEvent, toolId: string) => {
    e.stopPropagation();
    toggleFavorite(toolId);
    setFavRefresh(prev => prev + 1);
  };

  // Handle URL params for search and category
  useEffect(() => {
    const searchQuery = searchParams.get('q') || searchParams.get('search');
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
    <div className="space-y-7 max-w-[1500px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-black text-[#2f241b]">
          {search.trim() ? `搜索: ${search}` : activeCatName}
        </h1>
        <p className="text-[#6d5a47] text-lg mt-2">
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
            <Search className="search-icon absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8b735c]" />
          <input
            type="text"
            placeholder="搜索工具..."
            value={search}
            onChange={e => {
              const val = e.target.value;
              setSearch(val);
              setSearchParams(prev => {
                if (val) prev.set('q', val);
                else prev.delete('q');
                return prev;
              }, { replace: true });
            }}
            className="w-full pl-12 pr-4 py-4 rounded-xl text-[#2f241b] placeholder-[#8b735c] focus:outline-none text-lg"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setSearchParams(prev => { prev.delete('q'); return prev; }, { replace: true });
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8b735c] hover:text-[#2f241b]"
            >
              ✕
            </button>
          )}
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-[#8b735c]" />
          <select
            value={activeCategory || ''}
            onChange={(e) => setActiveCategory(e.target.value || null)}
            className="px-4 py-4 bg-[#fff4e6] border border-[#d8b58e] rounded-xl text-[#2f241b] focus:outline-none focus:border-[#9a5a28] appearance-none cursor-pointer text-base shadow-sm"
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
            className={`px-4 py-2.5 rounded-xl text-base transition-all ${
              !activeCategory
                ? 'bg-[#7a421b] text-[#fff8ef] border border-[#7a421b]'
                : 'bg-[#fff4e6] text-[#6d5a47] border border-[#d8b58e] hover:bg-[#f1dcc2] hover:border-[#b47a43] hover:text-[#6f3714]'
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
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-base transition-all ${
                  activeCategory === cat.id
                    ? 'bg-[#7a421b] text-[#fff8ef] border border-[#7a421b]'
                    : 'bg-[#fff4e6] text-[#6d5a47] border border-[#d8b58e] hover:bg-[#f1dcc2] hover:border-[#b47a43] hover:text-[#6f3714]'
                }`}
              >
                <CatIcon className="w-4 h-4" />
                {cat.name}
              </button>
            );
          })}
        </div>
      )}

      {/* 最近使用 */}
      {!search.trim() && !activeCategory && recentTools.length > 0 && (
        <div className="mb-6">
          <h2 className="text-2xl font-black text-[#2f241b] mb-3">最近使用</h2>
          <div className="flex flex-wrap gap-2">
            {recentTools.map(tool => {
              if (!tool) return null;
              const ToolIcon = getIcon(tool.icon);
              return (
                <button key={tool.id} onClick={() => openTool(tool.id)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#fff4e6] border border-[#d8b58e] hover:bg-[#f1dcc2] hover:border-[#b47a43] transition-all text-base">
                  <ToolIcon className="w-4 h-4 text-[#8b735c]" />
                  <span className="text-[#2f241b]">{tool.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 收藏工具 */}
      {!search.trim() && !activeCategory && favoriteTools.length > 0 && (
        <div className="mb-6">
          <h2 className="text-2xl font-black text-[#2f241b] mb-3">收藏工具</h2>
          <div className="flex flex-wrap gap-2">
            {favoriteTools.map(tool => {
              if (!tool) return null;
              const ToolIcon = getIcon(tool.icon);
              return (
                <button key={tool.id} onClick={() => openTool(tool.id)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f1dcc2] border border-[#d8b58e] hover:bg-[#ead0ad] transition-all text-base">
                  <ToolIcon className="w-4 h-4 text-[#9a5a28]" />
                  <span className="text-[#6f3714]">{tool.name}</span>
                </button>
              );
            })}
          </div>
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
                      <h3 className="tool-name text-xl font-bold text-[#2f241b] group-hover:text-[#6f3714] transition-colors truncate">
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
                    <p className="text-base text-[#6d5a47] mt-2 line-clamp-2">
                      {tool.description}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleToggleFav(e, tool.id)}
                    className={`shrink-0 p-1.5 rounded-lg transition-all ${
                      isFavorite(tool.id)
                        ? 'text-[#9a5a28] bg-[#f1dcc2]'
                        : 'text-[#9d8268] hover:text-[#8a4b1f] hover:bg-[#f1dcc2]'
                    }`}
                    title={isFavorite(tool.id) ? '取消收藏' : '收藏'}
                  >
                    {isFavorite(tool.id) ? '★' : '☆'}
                  </button>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      <AdSlot name="tools-inline" className="mt-8" />
    </div>
  );
};

export default ToolboxPage;
