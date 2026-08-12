import { describe, expect, it } from 'vitest';

import type { ToolDef } from '../tools/registry';
import {
  filterAssessmentTools,
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
});
