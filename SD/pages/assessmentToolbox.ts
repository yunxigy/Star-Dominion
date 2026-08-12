import type { AssessmentGroup } from '../components/tools/test/assessment/types';
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
