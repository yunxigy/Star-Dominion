import type { AssessmentGroup } from '../components/tools/test/assessment/types';
import type { AssessmentHistoryRecord } from '../components/tools/test/assessment/assessmentHistory';
import type { ToolDef } from '../tools/registry';

export const ASSESSMENT_GROUPS = [
  { id: 'fun', label: '趣味' },
  { id: 'personality', label: '人格' },
  { id: 'orientation', label: '倾向与边界' },
] as const;

export function isAssessmentGroup(
  value: string | null,
): value is AssessmentGroup {
  return ASSESSMENT_GROUPS.some((group) => group.id === value);
}

export function filterAssessmentTools(
  tools: ToolDef[],
  group: AssessmentGroup | null,
): ToolDef[] {
  if (!group) return tools;
  return tools.filter((tool) => tool.assessmentGroup === group);
}

export function syncAssessmentParam(
  params: URLSearchParams,
  activeCategory: string | null,
  search: string,
  group: AssessmentGroup | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (activeCategory === 'test' && !search.trim() && group) {
    next.set('assessment', group);
  } else {
    next.delete('assessment');
  }
  return next;
}

export function formatAssessmentHistorySummary(record: AssessmentHistoryRecord): string {
  const variantLabel = record.variantId === 'quick' ? '简易测试' : '完整测试';
  if (record.status === 'in-progress') {
    return `继续第 ${Math.min(record.currentIndex + 1, record.totalQuestions)} 题 · ${variantLabel}`;
  }
  return `${record.resultLabel ?? '已完成测评'} · ${variantLabel}`;
}
