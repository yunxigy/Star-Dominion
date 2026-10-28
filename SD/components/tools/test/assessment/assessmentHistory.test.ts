// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearAssessmentHistory,
  getAssessmentHistory,
  getAssessmentProgress,
  saveAssessmentProgress,
  saveAssessmentResult,
} from './assessmentHistory';

describe('assessment history storage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('keeps one resumable progress record for each assessment variant', () => {
    saveAssessmentProgress({
      definitionId: 'brain-power-test',
      variantId: 'quick',
      currentIndex: 3,
      totalQuestions: 12,
      answers: { q1: 'a', q2: null },
    });
    saveAssessmentProgress({
      definitionId: 'brain-power-test',
      variantId: 'quick',
      currentIndex: 5,
      totalQuestions: 12,
      answers: { q1: 'a', q2: 'b' },
    });

    expect(getAssessmentProgress('brain-power-test', 'quick')).toMatchObject({
      currentIndex: 5,
      totalQuestions: 12,
      answers: { q1: 'a', q2: 'b' },
      status: 'in-progress',
    });
    expect(getAssessmentHistory()).toHaveLength(1);
  });

  it('moves a completed attempt into history and removes its resumable draft', () => {
    saveAssessmentProgress({
      definitionId: 'communication-style-test',
      variantId: 'complete',
      currentIndex: 2,
      totalQuestions: 24,
      answers: { q1: 'direct' },
    });
    saveAssessmentResult({
      definitionId: 'communication-style-test',
      variantId: 'complete',
      totalQuestions: 24,
      answers: { q1: 'direct', q2: 'analytical' },
      resultLabel: '直接表达型',
      overallPercentage: undefined,
    });

    expect(getAssessmentProgress('communication-style-test', 'complete')).toBeNull();
    expect(getAssessmentHistory()).toMatchObject([
      {
        status: 'completed',
        resultLabel: '直接表达型',
        totalQuestions: 24,
      },
    ]);
  });

  it('clears old records without throwing when storage contains invalid JSON', () => {
    window.localStorage.setItem('sd-assessment-history', '{not-json');

    expect(getAssessmentHistory()).toEqual([]);
    expect(() => clearAssessmentHistory()).not.toThrow();
    expect(getAssessmentHistory()).toEqual([]);
  });
});
