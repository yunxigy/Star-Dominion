import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { ToolLink } from '../components/ToolLink';
import { getIcon } from '../lib/iconMap';
import { CATEGORIES, TOOLS } from '../tools/registry';

const normalize = (value: string) => value.trim().toLocaleLowerCase();

export function MiniToolsPage() {
  const [query, setQuery] = useState('');
  const needle = normalize(query);
  const filteredTools = useMemo(() => {
    if (!needle) return TOOLS;

    return TOOLS.filter((tool) =>
      normalize([tool.name, tool.description, ...(tool.tags ?? [])].join(' ')).includes(needle),
    );
  }, [needle]);

  const visibleCategories = needle
    ? CATEGORIES.filter((category) => filteredTools.some((tool) => tool.category === category.id))
    : CATEGORIES;

  const specialEntries = [
    { href: '/games', name: '趣味游戏', description: '小游戏和本地 AI 对战', icon: 'Gamepad2', external: false },
  ] as const;

  return (
    <div className="mini-tools-home">
      <section className="mini-tools-home__hero" aria-labelledby="mini-tools-title">
        <p className="mini-tools-home__eyebrow">逐梦工具箱 · 小程序工具版</p>
        <h1 id="mini-tools-title">工具箱</h1>
        <p>常用 PDF、图片、开发、计算和生活工具，打开即用。</p>
        <label className="mini-tools-home__search">
          <span className="sr-only">搜索工具</span>
          <Search aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索工具"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工具名称或关键词"
          />
        </label>
      </section>

      <section className="mini-tools-home__categories" aria-labelledby="mini-category-title">
        <div className="mini-section-heading">
          <h2 id="mini-category-title">工具分类</h2>
          <span>{filteredTools.length} 个工具</span>
        </div>
        <div className="mini-category-scroller">
          {visibleCategories.map((category) => {
            const Icon = getIcon(category.icon);
            const count = filteredTools.filter((tool) => tool.category === category.id).length;

            return (
              <Link
                key={category.id}
                to={`/gj?category=${encodeURIComponent(category.id)}`}
                className="mini-category-chip"
              >
                <Icon aria-hidden="true" />
                <span>{category.name}</span>
                <small>{count}</small>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mini-tools-home__list" aria-labelledby="mini-tool-list-title">
        <div className="mini-section-heading">
          <h2 id="mini-tool-list-title">全部工具</h2>
          <span>本地优先</span>
        </div>
        <div className="mini-special-grid" aria-label="其他工具入口">
          {specialEntries.map((entry) => {
            const Icon = getIcon(entry.icon);
            const content = (
              <>
                <span className="mini-tool-card__icon bg-gradient-to-br from-[#5f6f42] to-[#9a5a28]">
                  <Icon aria-hidden="true" />
                </span>
                <span className="mini-tool-card__name">{entry.name}</span>
                <span className="mini-tool-card__description">{entry.description}</span>
              </>
            );

            return entry.external ? (
              <a key={entry.href} href={entry.href} className="mini-tool-card">
                {content}
              </a>
            ) : (
              <Link key={entry.href} to={entry.href} className="mini-tool-card">
                {content}
              </Link>
            );
          })}
        </div>
        <div className="mini-tool-grid">
          {filteredTools.map((tool) => {
            const Icon = getIcon(tool.icon);

            return (
              <ToolLink key={tool.id} toolId={tool.id} aria-label={`打开 ${tool.name}`} className="mini-tool-card">
                <span className={`mini-tool-card__icon bg-gradient-to-br ${tool.gradient}`}>
                  <Icon aria-hidden="true" />
                </span>
                <span className="mini-tool-card__name">{tool.name}</span>
                <span className="mini-tool-card__description">{tool.description}</span>
              </ToolLink>
            );
          })}
        </div>
        {filteredTools.length === 0 && <p className="mini-tools-home__empty">没有找到匹配工具，换个关键词试试。</p>}
      </section>
    </div>
  );
}

export default MiniToolsPage;
