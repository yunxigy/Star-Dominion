import { ArrowDown, ArrowUp, ExternalLink, Flame, GitFork, Minus, RotateCcw, Sparkles, Star } from 'lucide-react';

import type { RankingRepository } from '../../lib/researchReports';
import { formatNumber, toRankSignal } from './reportViewModel';


function Signal({ item }: { item: RankingRepository }) {
  const signal = toRankSignal(item);
  const Icon = signal.icon === 'up' ? ArrowUp
    : signal.icon === 'down' ? ArrowDown
      : signal.icon === 'new' ? Sparkles
        : signal.icon === 'returned' ? RotateCcw
          : Minus;
  const tone = signal.icon === 'up' || signal.icon === 'new'
    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : signal.icon === 'down'
      ? 'text-rose-700 bg-rose-50 border-rose-200'
      : 'text-[#725e4d] bg-[#f6eee4] border-[#e1d0bc]';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold ${tone}`}><Icon className="h-3.5 w-3.5" />{signal.label}</span>;
}

function ProjectMeta({ item }: { item: RankingRepository }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#756250]">
      <span className="font-semibold">{item.primaryLanguage || '语言待补全'}</span>
      <span>{item.licenseSpdx || '许可证待补全'}</span>
      <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5" />{formatNumber(item.starsTotal)}</span>
      <span className="inline-flex items-center gap-1"><GitFork className="h-3.5 w-3.5" />{formatNumber(item.forksTotal)}</span>
      <span className="inline-flex items-center gap-1 font-bold text-[#a45121]"><Flame className="h-3.5 w-3.5" />本周 +{formatNumber(item.starsSinceWeekly)}</span>
      {item.consecutiveWeeks > 1 && <span>连续 {item.consecutiveWeeks} 周</span>}
    </div>
  );
}
export function RankingList({ items, loading }: { items: RankingRepository[]; loading: boolean }) {
  if (loading) {
    return <div className="rounded-[1.75rem] border border-[#decbb5] bg-white/80 p-12 text-center text-[#756250]" aria-live="polite">正在读取真实 GitHub 榜单…</div>;
  }
  if (items.length === 0) {
    return <div className="rounded-[1.75rem] border border-dashed border-[#c9ad91] bg-[#fff8ee] p-12 text-center"><p className="text-lg font-bold text-[#4c392a]">当前筛选没有项目</p><p className="mt-2 text-sm text-[#806b58]">可以清除筛选，或等待下一次真实采集完成。</p></div>;
  }
  return (
    <>
      <div className="hidden overflow-hidden rounded-[1.75rem] border border-[#decbb5] bg-white/90 shadow-sm md:block">
        <div role="list" aria-label="GitHub 项目排名" className="divide-y divide-[#eadbca]">
          {items.map((item) => (
            <article key={item.id} role="listitem" className="grid grid-cols-[64px_minmax(0,1fr)_150px] gap-5 p-5 transition hover:bg-[#fff9f0]">
              <div className="text-center"><div className="text-xs text-[#97816c]">排名</div><div className="mt-1 text-3xl font-black text-[#392b20]">{item.rank}</div></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><a href={item.htmlUrl} target="_blank" rel="noopener noreferrer" className="truncate text-lg font-black text-[#2f241b] hover:text-[#9b4f22]">{item.fullName}</a><Signal item={item} /></div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#6d5a47]">{item.description || 'GitHub 暂未提供项目简介。'}</p>
                <ProjectMeta item={item} />
              </div>
              <div className="flex items-center justify-end"><a href={item.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[#d6bea5] px-3 py-2 text-sm font-bold text-[#674b35] hover:border-[#9b5e31] hover:bg-[#fff3e5]">查看 GitHub<ExternalLink className="h-4 w-4" /></a></div>
            </article>
          ))}
        </div>
      </div>
      <div role="list" aria-label="GitHub 项目排名" className="grid gap-3 md:hidden">
        {items.map((item) => (
          <article key={item.id} role="listitem" className="rounded-2xl border border-[#decbb5] bg-white/90 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3"><span className="rounded-xl bg-[#392b20] px-3 py-2 text-lg font-black text-white">#{item.rank}</span><Signal item={item} /></div>
            <a href={item.htmlUrl} target="_blank" rel="noopener noreferrer" className="mt-4 block break-all text-lg font-black text-[#2f241b]">{item.fullName}</a>
            <p className="mt-2 text-sm leading-6 text-[#6d5a47]">{item.description || 'GitHub 暂未提供项目简介。'}</p>
            <ProjectMeta item={item} />
          </article>
        ))}
      </div>
    </>
  );
}
