import { Search } from 'lucide-react';

import type { RankingStatus, ReportCategory } from '../../lib/researchReports';
import { REPORT_CATEGORIES } from './reportViewModel';


export function ReportFilters({
  category,
  onCategoryChange,
  query,
  onQueryChange,
  license,
  onLicenseChange,
  status,
  onStatusChange,
}: {
  category: ReportCategory;
  onCategoryChange: (value: ReportCategory) => void;
  query: string;
  onQueryChange: (value: string) => void;
  license: string;
  onLicenseChange: (value: string) => void;
  status: RankingStatus | '';
  onStatusChange: (value: RankingStatus | '') => void;
}) {
  return (
    <section className="rounded-[1.75rem] border border-[#decbb5] bg-[#fffaf2]/90 p-4 shadow-sm sm:p-5">
      <div role="tablist" aria-label="GitHub 周榜分类" className="flex gap-2 overflow-x-auto pb-2">
        {REPORT_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={category === item.id}
            onClick={() => onCategoryChange(item.id)}
            className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-bold transition ${
              category === item.id
                ? 'bg-[#392b20] text-white shadow-md'
                : 'border border-[#decbb5] bg-white text-[#6d5947] hover:border-[#a96b3a]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
        <label className="relative block">
          <span className="sr-only">搜索项目</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b7562]" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索项目、作者或简介"
            className="w-full rounded-xl border border-[#d8c4ad] bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-[#9b5e31] focus:ring-2 focus:ring-[#d9aa80]/30"
          />
        </label>
        <label>
          <span className="sr-only">许可证</span>
          <select value={license} onChange={(event) => onLicenseChange(event.target.value)} className="w-full rounded-xl border border-[#d8c4ad] bg-white px-3 py-3 text-sm">
            <option value="">全部许可证</option>
            <option value="MIT">MIT</option>
            <option value="Apache-2.0">Apache-2.0</option>
            <option value="GPL-3.0">GPL-3.0</option>
          </select>
        </label>
        <label>
          <span className="sr-only">上榜状态</span>
          <select value={status} onChange={(event) => onStatusChange(event.target.value as RankingStatus | '')} className="w-full rounded-xl border border-[#d8c4ad] bg-white px-3 py-3 text-sm">
            <option value="">全部状态</option>
            <option value="new">新上榜</option>
            <option value="returned">重新上榜</option>
            <option value="rising">排名上升</option>
            <option value="falling">排名下降</option>
            <option value="steady">排名持平</option>
          </select>
        </label>
      </div>
    </section>
  );
}
