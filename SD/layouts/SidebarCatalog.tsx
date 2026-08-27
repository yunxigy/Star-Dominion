import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, SearchX, Star } from 'lucide-react';
import { CATEGORIES, TOOLS, getToolsByCategory } from '../tools/registry';
import { getIcon } from '../lib/iconMap';
import { ToolLink } from '../components/ToolLink';
import { filterSidebarTools } from './filterSidebarTools';

type SidebarCatalogProps = {
  onNavigate: () => void;
};

export const SidebarCatalog: React.FC<SidebarCatalogProps> = ({ onNavigate }) => {
  const [query, setQuery] = useState('');
  const location = useLocation();
  const currentToolId = location.pathname.match(/^\/tool\/([^/]+)$/)?.[1];
  const currentTool = TOOLS.find(tool => tool.id === currentToolId);
  const matches = useMemo(() => filterSidebarTools(TOOLS, query), [query]);
  const selectedCategory = new URLSearchParams(location.search).get('category');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="px-3 pb-2 pt-3">
        <span className="sr-only">搜索工具</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b735c]" aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索工具"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索工具、拼音或别名"
            className="w-full rounded-xl border border-[#d8b58e] bg-[#fff4e6] py-3 pl-9 pr-3 text-sm text-[#2f241b] placeholder-[#8b735c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9a5a28]"
          />
        </span>
      </label>

      <nav aria-label="工具目录" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
        {query.trim() ? (
          matches.length > 0 ? (
            matches.map(tool => (
              <ToolLink
                key={tool.id}
                toolId={tool.id}
                onClick={onNavigate}
                className="sidebar-item"
                aria-current={currentToolId === tool.id ? 'page' : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{tool.name}</span>
                <span className="text-xs text-[#9d8268]">{CATEGORIES.find(category => category.id === tool.category)?.name}</span>
              </ToolLink>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-[#d8b58e] px-3 py-4 text-center text-sm text-[#8b735c]" role="status">
              <SearchX className="mx-auto mb-2 h-4 w-4" aria-hidden="true" />
              没有找到匹配工具
            </div>
          )
        ) : (
          <>
            {CATEGORIES.map(category => {
              const CategoryIcon = getIcon(category.icon);
              const count = getToolsByCategory(category.id).length;
              const isActive = location.pathname === `/category/${category.id}`
                || selectedCategory === category.id
                || currentTool?.category === category.id;
              return (
                <Link
                  key={category.id}
                  to={`/category/${category.id}`}
                  onClick={onNavigate}
                  aria-current={isActive ? 'page' : undefined}
                  className={`sidebar-item ${isActive ? 'active' : ''}`}
                >
                  <span className={`rounded-lg bg-gradient-to-br ${category.gradient} p-1.5 ${isActive ? 'shadow-md shadow-emerald-500/25' : 'opacity-80'}`}>
                    <CategoryIcon className="h-4 w-4 text-white" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 text-left font-medium">{category.name}</span>
                  <span className="rounded-full bg-[#f1dcc2] px-2 py-0.5 text-xs text-[#6d5a47]">{count}</span>
                </Link>
              );
            })}
            <div className="mt-4 flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-[#8b735c]">
              <Star className="h-3 w-3" aria-hidden="true" />
              搜索支持名称、拼音和别名
            </div>
          </>
        )}
      </nav>
    </div>
  );
};

export default SidebarCatalog;
