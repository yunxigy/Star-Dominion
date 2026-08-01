import { CalendarDays, Clock3, Github, Radio } from 'lucide-react';

import type { CollectionStatus, IssueSummary } from '../../lib/researchReports';
import { formatIssue } from './reportViewModel';


const formatTime = (value: string | null) => value
  ? new Date(value).toLocaleString('zh-CN', { hour12: false })
  : '尚未完成采集';

export function ReportHeader({ issue, status }: {
  issue: IssueSummary | null;
  status: CollectionStatus | null;
}) {
  const delayed = status?.status === 'delayed';
  return (
    <header className="relative overflow-hidden rounded-[2rem] border border-[#d7c1a8] bg-[#2b2119] px-6 py-8 text-[#fff8ed] shadow-xl sm:px-9 sm:py-10">
      <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#d97736]/20 blur-3xl" />
      <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-sm text-[#f6d6b8]">
            <Github className="h-4 w-4" />
            开源情报 · 每小时更新
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-5xl">GitHub 开源项目周榜</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[#dccbbb] sm:text-base">
            扫描综合与五大语言周榜，用排名变化和 Star 增长识别正在加速的开源项目。
          </p>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:min-w-[430px]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-[#bda999]"><CalendarDays className="h-4 w-4" /> 当前期</div>
            <div className="mt-2 text-xl font-bold">{issue ? formatIssue(issue.isoYear, issue.isoWeek) : '等待建刊'}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-[#bda999]"><Radio className="h-4 w-4" /> 数据状态</div>
            <div className={`mt-2 font-bold ${delayed ? 'text-amber-300' : 'text-emerald-300'}`}>
              {delayed ? '数据延迟' : '数据正常'}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:col-span-2">
            <div className="flex items-center gap-2 text-[#bda999]"><Clock3 className="h-4 w-4" /> 最近成功采集</div>
            <div className="mt-2 font-semibold">{formatTime(status?.latestSuccessfulCollectionAt ?? null)}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
