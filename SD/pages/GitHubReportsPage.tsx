import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Flame, Sparkles, Star, TrendingUp } from 'lucide-react';

import { AdminCollectionPanel } from '../components/reports/AdminCollectionPanel';
import { RankingList } from '../components/reports/RankingList';
import { ReportFilters } from '../components/reports/ReportFilters';
import { ReportHeader } from '../components/reports/ReportHeader';
import type { CollectionStatus, IssueSummary, RankingResponse, RankingStatus, ReportCategory } from '../lib/researchReports';
import { getCollectionStatus, getRankings, listIssues } from '../lib/researchReports';


export function GitHubReportsPage() {
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [issueId, setIssueId] = useState('');
  const [category, setCategory] = useState<ReportCategory>('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [license, setLicense] = useState('');
  const [rankingStatus, setRankingStatus] = useState<RankingStatus | ''>('');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadOverview = useCallback(async () => {
    const [nextIssues, nextStatus] = await Promise.all([listIssues(), getCollectionStatus()]);
    setIssues(nextIssues);
    setStatus(nextStatus);
    setIssueId((current) => current || nextIssues[0]?.id || '');
  }, []);

  const loadRankings = useCallback(async () => {
    if (!issueId) { setLoading(false); return; }
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const response = await getRankings(issueId, { category, query: debouncedQuery, license, status: rankingStatus });
      if (version === requestVersion.current) setData(response);
    } catch (reason) {
      if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : '无法读取榜单');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [issueId, category, debouncedQuery, license, rankingStatus]);

  useEffect(() => { void loadOverview().catch((reason) => { setError(reason instanceof Error ? reason.message : '研报服务不可用'); setLoading(false); }); }, [loadOverview]);
  useEffect(() => { void loadRankings(); }, [loadRankings]);

  const refreshAll = async () => {
    await loadOverview();
    await loadRankings();
  };
  const currentIssue = issues.find((issue) => issue.id === issueId) || issues[0] || null;
  const summary = data?.summary;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-12">
      <ReportHeader issue={currentIssue} status={status} />
      {status?.status === 'delayed' && <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><strong>数据延迟</strong><p className="mt-1">部分榜单超过 90 分钟未成功更新，页面继续展示最近一次真实数据。</p></div></div>}
      <AdminCollectionPanel onCompleted={refreshAll} />
      {issues.length > 1 && <label className="inline-flex items-center gap-3 rounded-xl border border-[#decbb5] bg-white px-4 py-3 text-sm font-bold text-[#564333]">历史周期<select value={issueId} onChange={(event) => setIssueId(event.target.value)} className="bg-transparent font-semibold outline-none">{issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.isoYear}-W{String(issue.isoWeek).padStart(2, '0')}</option>)}</select></label>}
      <ReportFilters category={category} onCategoryChange={setCategory} query={query} onQueryChange={setQuery} license={license} onLicenseChange={setLicense} status={rankingStatus} onStatusChange={setRankingStatus} />
      {summary && <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><SummaryCard icon={Sparkles} label="新上榜" value={summary.newCount} /><SummaryCard icon={TrendingUp} label="持续热门" value={summary.continuingCount} /><SummaryCard icon={Star} label="榜单本周 Star" value={summary.starsSinceWeeklyTotal.toLocaleString('zh-CN')} /><SummaryCard icon={Flame} label="增长最快" value={summary.fastestGrowthFullName || '等待数据'} compact /></section>}
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800" role="alert">{error}</div>}
      <RankingList items={data?.items ?? []} loading={loading} />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, compact = false }: { icon: typeof Star; label: string; value: string | number; compact?: boolean }) {
  return <div className="rounded-2xl border border-[#decbb5] bg-[#fffaf2] p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#8a725c]"><Icon className="h-4 w-4" />{label}</div><div className={`mt-2 font-black text-[#35281f] ${compact ? 'truncate text-base' : 'text-2xl'}`} title={String(value)}>{value}</div></div>;
}
