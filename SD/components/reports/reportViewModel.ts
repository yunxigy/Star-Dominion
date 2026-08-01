import type { RankingRepository, RankingStatus, ReportCategory } from '../../lib/researchReports';

export const REPORT_CATEGORIES: ReadonlyArray<{ id: ReportCategory; label: string }> = [
  { id: 'all', label: '综合榜' },
  { id: 'python', label: 'Python' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
];

export interface RankSignal {
  label: string;
  icon: 'up' | 'down' | 'steady' | 'new' | 'returned';
  delta: number;
}

export function toRankSignal(
  entry: Pick<RankingRepository, 'rank' | 'previousIssueRank' | 'status'>,
): RankSignal {
  if (entry.status === 'new') return { label: '新上榜', icon: 'new', delta: 0 };
  if (entry.status === 'returned') return { label: '重新上榜', icon: 'returned', delta: 0 };
  const delta = entry.previousIssueRank == null ? 0 : entry.previousIssueRank - entry.rank;
  if (delta > 0) return { label: `上升 ${delta} 位`, icon: 'up', delta };
  if (delta < 0) return { label: `下降 ${Math.abs(delta)} 位`, icon: 'down', delta };
  return { label: '排名持平', icon: 'steady', delta: 0 };
}

export function rankingStatusLabel(status: RankingStatus): string {
  const labels: Record<RankingStatus, string> = {
    new: '新上榜',
    returned: '重新上榜',
    rising: '排名上升',
    falling: '排名下降',
    steady: '排名持平',
  };
  return labels[status];
}

export const formatNumber = (value: number): string =>
  new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export const formatIssue = (isoYear: number, isoWeek: number): string =>
  `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
