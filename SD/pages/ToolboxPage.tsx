import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, SearchX, Filter } from 'lucide-react';
import { getIcon } from '../lib/iconMap';
import { CATEGORIES, TOOLS, getToolsByCategory } from '../tools/registry';
import { ToolLink } from '../components/ToolLink';
import { AdSlot } from '../components/AdSlot';
import { getRecentTools, getFavoriteTools, toggleFavorite, isFavorite } from '../lib/userTools';
import type { AssessmentGroup } from '../components/tools/test/assessment/types';
import {
  ASSESSMENT_GROUPS,
  filterAssessmentTools,
  isAssessmentGroup,
  syncAssessmentParam,
} from './assessmentToolbox';
import { getAssessmentBadges } from './assessmentBadges';
import { getToolCardActionClass, getToolCardContentClass, getToolCardLayoutClass } from './toolCardLayout';
import { TOOLBOX_CARD_DESCRIPTION_CLASS, TOOLBOX_CARD_TITLE_CLASS } from './toolUiLayout';
import { getToolSuggestions } from './toolSuggestions';

export const ToolboxPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeAssessmentGroup, setActiveAssessmentGroup] = useState<AssessmentGroup | null>(null);
  const [search, setSearch] = useState('');
  const [favRefresh, setFavRefresh] = useState(0);

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
    setSearch(searchQuery || '');
    setActiveCategory(
      categoryQuery && CATEGORIES.find(c => c.id === categoryQuery)
        ? categoryQuery
        : null,
    );
    const assessmentQuery = searchParams.get('assessment');
    setActiveAssessmentGroup(
      categoryQuery === 'test' && !searchQuery && isAssessmentGroup(assessmentQuery)
        ? assessmentQuery
        : null,
    );
  }, [searchParams]);

  const handleCategoryChange = (category: string | null) => {
    setActiveCategory(category);
    setActiveAssessmentGroup(null);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (category) next.set('category', category);
      else next.delete('category');
      return syncAssessmentParam(next, category, search, null);
    }, { replace: true });
  };

  const handleAssessmentGroupChange = (group: AssessmentGroup | null) => {
    setActiveAssessmentGroup(group);
    setSearchParams(
      prev => syncAssessmentParam(prev, activeCategory, search, group),
      { replace: true },
    );
  };

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
      const categoryTools = getToolsByCategory(activeCategory);
      return activeCategory === 'test'
        ? filterAssessmentTools(categoryTools, activeAssessmentGroup)
        : categoryTools;
    }
    return TOOLS;
  }, [activeAssessmentGroup, activeCategory, search]);

  const activeCatName = activeCategory
    ? CATEGORIES.find(c => c.id === activeCategory)?.name
    : '全部工具';

  const suggestions = useMemo(
    () => getToolSuggestions(TOOLS, search.trim() || (activeCategory ? activeCatName ?? '' : ''), 6),
    [activeCatName, activeCategory, search],
  );

  const clearFilters = () => {
    setSearch('');
    setActiveCategory(null);
    setActiveAssessmentGroup(null);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      ['q', 'search', 'category', 'assessment'].forEach(key => next.delete(key));
      return next;
    }, { replace: true });
  };

  const renderCategoryActions = () => (
    <>
      <button
        type="button"
        onClick={() => handleCategoryChange(null)}
        className={`px-4 py-2.5 rounded-xl text-base transition-colors ${
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
            type="button"
            key={cat.id}
            onClick={() => handleCategoryChange(cat.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-base transition-colors ${
              activeCategory === cat.id
                ? 'bg-[#7a421b] text-[#fff8ef] border border-[#7a421b]'
                : 'bg-[#fff4e6] text-[#6d5a47] border border-[#d8b58e] hover:bg-[#f1dcc2] hover:border-[#b47a43] hover:text-[#6f3714]'
            }`}
          >
            <CatIcon className="w-4 h-4" aria-hidden="true" />
            {cat.name}
          </button>
        );
      })}
    </>
  );

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
          <label htmlFor="toolbox-search" className="sr-only">搜索工具</label>
          <input
            id="toolbox-search"
            type="search"
            placeholder="搜索工具..."
            value={search}
            onChange={e => {
              const val = e.target.value;
              setSearch(val);
              setSearchParams(prev => {
                const next = new URLSearchParams(prev);
                if (val) next.set('q', val);
                else next.delete('q');
                return syncAssessmentParam(next, activeCategory, val, activeAssessmentGroup);
              }, { replace: true });
            }}
            className="w-full pl-12 pr-4 py-4 rounded-xl text-[#2f241b] placeholder-[#8b735c] text-lg"
          />
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setSearchParams(prev => {
                  const next = new URLSearchParams(prev);
                  next.delete('q');
                  return syncAssessmentParam(next, activeCategory, '', activeAssessmentGroup);
                }, { replace: true });
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
            onChange={(e) => handleCategoryChange(e.target.value || null)}
            className="px-4 py-4 bg-[#fff4e6] border border-[#d8b58e] rounded-xl text-[#2f241b] focus:border-[#9a5a28] appearance-none cursor-pointer text-base shadow-sm"
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
        <>
          <div className="hidden flex-wrap gap-2 md:flex">
            {renderCategoryActions()}
          </div>
          <details className="rounded-2xl border border-[#d8b58e] bg-[#fff8ef] shadow-sm md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold text-[#5c4937]">
              <span>筛选工具</span>
              <span className="rounded-full bg-[#f1dcc2] px-3 py-1 text-sm text-[#7a421b]">{activeCatName}</span>
            </summary>
            <div className="flex flex-wrap gap-2 border-t border-[#ead8c2] px-4 py-4">
              {renderCategoryActions()}
            </div>
          </details>
        </>
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
                <ToolLink key={tool.id} toolId={tool.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#fff4e6] border border-[#d8b58e] hover:bg-[#f1dcc2] hover:border-[#b47a43] transition-colors text-base">
                  <ToolIcon className="w-4 h-4 text-[#8b735c]" />
                  <span className="text-[#2f241b]">{tool.name}</span>
                </ToolLink>
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
                <ToolLink key={tool.id} toolId={tool.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f1dcc2] border border-[#d8b58e] hover:bg-[#ead0ad] transition-colors text-base">
                  <ToolIcon className="w-4 h-4 text-[#9a5a28]" />
                  <span className="text-[#6f3714]">{tool.name}</span>
                </ToolLink>
              );
            })}
          </div>
        </div>
      )}

      {/* Assessment Groups */}
      {!search.trim() && activeCategory === 'test' && (
        <div className="rounded-2xl border border-[#d8b58e] bg-[#fff8ef] p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2" aria-label="测评分组">
            <span className="px-2 text-sm font-semibold text-[#7b624d]">按方向筛选</span>
            <button
              type="button"
              onClick={() => handleAssessmentGroupChange(null)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                activeAssessmentGroup === null
                  ? 'border-[#7a421b] bg-[#7a421b] text-[#fff8ef]'
                  : 'border-[#d8b58e] bg-white text-[#6d5a47] hover:border-[#b47a43]'
              }`}
            >
              全部
            </button>
            {ASSESSMENT_GROUPS.map(group => (
              <button
                key={group.id}
                type="button"
                onClick={() => handleAssessmentGroupChange(group.id)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                  activeAssessmentGroup === group.id
                    ? group.id === 'fun'
                      ? 'border-orange-500 bg-orange-500 text-white'
                      : group.id === 'personality'
                        ? 'border-violet-600 bg-violet-600 text-white'
                        : 'border-rose-600 bg-rose-600 text-white'
                    : 'border-[#d8b58e] bg-white text-[#6d5a47] hover:border-[#b47a43]'
                }`}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tool Grid */}
      {displayTools.length === 0 ? (
        <div className="empty-state" role="status">
          <div className="empty-icon">
            <SearchX className="w-7 h-7 text-[#9a5a28]/60" aria-hidden="true" />
          </div>
          <h3>没有找到匹配的工具</h3>
          <p>{search.trim() ? `“${search.trim()}”没有匹配结果` : `“${activeCatName}”暂时没有可显示的工具`}</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 rounded-xl border border-[#d8b58e] bg-[#fff4e6] px-4 py-2 text-sm font-semibold text-[#7a421b] transition hover:bg-[#f1dcc2]"
          >
            清除搜索和筛选
          </button>
          {suggestions.length > 0 && (
            <div className="mt-6 w-full max-w-2xl">
              <p className="mb-3 text-left text-sm font-semibold text-[#6d5a47]">你也可以试试</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {suggestions.map(tool => {
                  const SuggestionIcon = getIcon(tool.icon);
                  return (
                    <ToolLink
                      key={tool.id}
                      toolId={tool.id}
                      className="flex items-center gap-3 rounded-xl border border-[#d8b58e] bg-[#fff4e6] px-3 py-3 text-left transition hover:border-[#b47a43] hover:bg-[#f1dcc2]"
                    >
                      <span className={`rounded-lg bg-gradient-to-br ${tool.gradient} p-2`}>
                        <SuggestionIcon className="h-4 w-4 text-white" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#2f241b]">{tool.name}</span>
                        <span className="block truncate text-xs text-[#8b735c]">{tool.description}</span>
                      </span>
                    </ToolLink>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {displayTools.map((tool, index) => {
            const ToolIcon = getIcon(tool.icon);
            return (
              <motion.div
                key={tool.id}
                initial={index < 18 ? { opacity: 0, y: 12 } : false}
                animate={index < 18 ? { opacity: 1, y: 0 } : undefined}
                transition={{ delay: Math.min(index * 0.02, 0.5), duration: 0.3 }}
                className={getToolCardLayoutClass(tool.category)}
              >
                <div className={getToolCardContentClass(tool.category)}>
                  <ToolLink
                    toolId={tool.id}
                    className={getToolCardActionClass(tool.category)}
                    aria-label={`打开${tool.name}`}
                  >
                    <div className={`tool-icon p-3 rounded-xl bg-gradient-to-br ${tool.gradient} shadow-lg shrink-0`}>
                      <ToolIcon className="w-6 h-6 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className={`tool-name ${TOOLBOX_CARD_TITLE_CLASS} group-hover:text-[#6f3714] transition-colors`}>
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
                      <p className={TOOLBOX_CARD_DESCRIPTION_CLASS}>
                        {tool.description}
                      </p>
                      {tool.category === 'test' && (
                        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold text-[#725945]">
                          {getAssessmentBadges(tool.assessmentGroup, tool.questionCount, tool.estimatedMinutes).map((badge) => (
                            <span key={badge.label} className={`rounded-full px-2.5 py-1 ${
                              badge.tone === 'fun'
                                ? 'bg-orange-100 text-orange-800'
                                : badge.tone === 'personality'
                                  ? 'bg-violet-100 text-violet-800'
                                  : badge.tone === 'orientation'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-[#f1dcc2] text-[#725945]'
                            }`}>
                              {badge.label}
                            </span>
                          ))}
                          {tool.privacy === 'local' && (
                            <span className="rounded-full bg-teal-100 px-2.5 py-1 text-teal-800">本地处理</span>
                          )}
                        </div>
                      )}
                    </div>
                  </ToolLink>
                  <button
                    type="button"
                    onClick={(e) => handleToggleFav(e, tool.id)}
                    className={`shrink-0 p-1.5 rounded-lg transition-colors ${
                      isFavorite(tool.id)
                        ? 'text-[#9a5a28] bg-[#f1dcc2]'
                        : 'text-[#9d8268] hover:text-[#8a4b1f] hover:bg-[#f1dcc2]'
                    }`}
                    title={isFavorite(tool.id) ? '取消收藏' : '收藏'}
                    aria-label={`${isFavorite(tool.id) ? '取消收藏' : '收藏'}${tool.name}`}
                  >
                    {isFavorite(tool.id) ? '★' : '☆'}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {displayTools.length > 0 && <AdSlot name="tools-inline" className="mt-8" />}
    </div>
  );
};

export default ToolboxPage;
