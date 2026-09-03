import { describe, expect, it } from 'vitest';

import type { ToolDef } from '../tools/registry';
import type { AssessmentHistoryRecord } from '../components/tools/test/assessment/assessmentHistory';
import {
  filterAssessmentTools,
  formatAssessmentHistorySummary,
  isAssessmentGroup,
  syncAssessmentParam,
} from './assessmentToolbox';

const tool = (
  id: string,
  assessmentGroup?: ToolDef['assessmentGroup'],
): ToolDef => ({ id, category: 'test', assessmentGroup } as ToolDef);

describe('assessment toolbox helpers', () => {
  it('accepts only declared assessment groups', () => {
    expect(isAssessmentGroup('fun')).toBe(true);
    expect(isAssessmentGroup('personality')).toBe(true);
    expect(isAssessmentGroup('orientation')).toBe(true);
    expect(isAssessmentGroup('popular')).toBe(false);
    expect(isAssessmentGroup(null)).toBe(false);
  });

  it('filters grouped tests and excludes ungrouped legacy tests', () => {
    const tools = [
      tool('fun-test', 'fun'),
      tool('personality-test', 'personality'),
      tool('legacy-test'),
    ];
    expect(filterAssessmentTools(tools, null)).toEqual(tools);
    expect(filterAssessmentTools(tools, 'fun').map(({ id }) => id)).toEqual([
      'fun-test',
    ]);
  });

  it('clones URL params and persists a valid active group', () => {
    const original = new URLSearchParams('category=test&keep=yes');
    const next = syncAssessmentParam(original, 'test', '', 'personality');

    expect(next.get('assessment')).toBe('personality');
    expect(next.get('keep')).toBe('yes');
    expect(original.has('assessment')).toBe(false);
  });

  it('removes the group for another category or an active search', () => {
    const params = new URLSearchParams('category=test&assessment=fun');
    expect(syncAssessmentParam(params, 'pdf', '', 'fun').has('assessment')).toBe(false);
    expect(syncAssessmentParam(params, 'test', '人格', 'fun').has('assessment')).toBe(false);
    expect(syncAssessmentParam(params, 'test', '', null).has('assessment')).toBe(false);
  });

  it('summarizes unfinished and completed assessment history for the toolbox', () => {
    const draft: AssessmentHistoryRecord = {
      id: 'draft',
      definitionId: 'brain-power-test',
      variantId: 'quick',
      status: 'in-progress',
      currentIndex: 2,
      totalQuestions: 10,
      answers: {},
      updatedAt: 1,
    };
    const result: AssessmentHistoryRecord = {
      ...draft,
      id: 'result',
      status: 'completed',
      resultLabel: '专注型解题者',
    };

    expect(formatAssessmentHistorySummary(draft)).toBe('继续第 3 题 · 简易测试');
    expect(formatAssessmentHistorySummary(result)).toBe('专注型解题者 · 简易测试');
  });
});
