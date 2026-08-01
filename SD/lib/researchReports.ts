export type ReportCategory = 'all' | 'python' | 'javascript' | 'typescript' | 'go' | 'rust';
export type RankingStatus = 'new' | 'returned' | 'rising' | 'falling' | 'steady';

export interface IssueSummary {
  id: string;
  isoYear: number;
  isoWeek: number;
  startsAt: string;
  sealedAt: string | null;
  status: 'collecting' | 'sealed' | 'delayed';
}

export interface RankingRepository {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  primaryLanguage: string | null;
  topics: string[];
  licenseSpdx: string | null;
  htmlUrl: string;
  isArchived: boolean;
  starsTotal: number;
  forksTotal: number;
  githubUpdatedAt: string | null;
  rank: number;
  previousIssueRank: number | null;
  starsSinceWeekly: number;
  firstSeenAt: string;
  lastSeenAt: string;
  consecutiveWeeks: number;
  status: RankingStatus;
  hourlyRankChange: number | null;
  hourlyStarChange: number | null;
}

export interface RankingSummary {
  newCount: number;
  continuingCount: number;
  starsSinceWeeklyTotal: number;
  fastestGrowthFullName: string | null;
}

export interface RankingResponse {
  issue: IssueSummary;
  category: ReportCategory;
  items: RankingRepository[];
  summary: RankingSummary;
}

export interface CollectionStatus {
  status: 'ok' | 'delayed';
  latestSuccessfulCollectionAt: string | null;
  nextScheduledAt: string | null;
  delayedCategories: ReportCategory[];
}

export interface CollectionRun {
  id?: string;
  runId?: string;
  trigger?: string;
  requestedBySiteUserId?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
  status: 'running' | 'success' | 'partial' | 'failed' | 'skipped_overlap';
  categories?: Record<string, unknown>;
  errorSummary?: string | null;
  durationMs?: number | null;
}

export interface RankingFilters {
  category: ReportCategory;
  query?: string;
  language?: string;
  license?: string;
  status?: RankingStatus | '';
}

const REPORT_BASE = '/reports-api/api/v1';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const candidate = part.trim();
    if (candidate.startsWith(prefix)) {
      return decodeURIComponent(candidate.slice(prefix.length));
    }
  }
  return null;
}

export class ReportApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function reportRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('sd_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  const response = await fetch(`${REPORT_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    const fallback: Record<number, string> = {
      401: '请先登录',
      403: '需要管理员权限',
      409: '已有采集任务运行中',
      503: '研报服务暂时不可用',
    };
    throw new ReportApiError(payload?.detail || fallback[response.status] || '研报请求失败', response.status);
  }
  return response.json() as Promise<T>;
}

export function buildRankingUrl(issueId: string, filters: RankingFilters): string {
  const params = new URLSearchParams();
  params.set('category', filters.category);
  const query = filters.query?.trim();
  if (query) params.set('query', query);
  if (filters.status) params.set('status', filters.status);
  if (filters.license) params.set('license', filters.license);
  if (filters.language) params.set('language', filters.language);
  return `/issues/${encodeURIComponent(issueId)}/rankings?${params.toString()}`;
}

export async function listIssues(): Promise<IssueSummary[]> {
  const page = await reportRequest<{ items: IssueSummary[] }>('/issues');
  return page.items;
}

export const getCurrentIssue = (): Promise<IssueSummary> =>
  reportRequest('/issues/current');

export const getRankings = (issueId: string, filters: RankingFilters): Promise<RankingResponse> =>
  reportRequest(buildRankingUrl(issueId, filters));

export const getCollectionStatus = (): Promise<CollectionStatus> =>
  reportRequest('/status');

export const startCollection = (): Promise<CollectionRun> =>
  reportRequest('/admin/collections', { method: 'POST' });

export const getCollectionRun = (runId: string): Promise<CollectionRun> =>
  reportRequest(`/admin/collections/${encodeURIComponent(runId)}`);
