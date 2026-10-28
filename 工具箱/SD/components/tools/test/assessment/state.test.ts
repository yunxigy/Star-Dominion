import { describe, expect, it } from 'vitest';

import {
  assessmentReducer,
  canAdvance,
  createAssessmentState,
} from './state';

describe('assessment state', () => {
  it('starts, records an answer, and replaces it when changed', () => {
    const started = assessmentReducer(createAssessmentState(), { type: 'start' });
    const answered = assessmentReducer(started, {
      type: 'answer',
      questionId: 'q1',
      optionId: 'a',
    });
    const changed = assessmentReducer(answered, {
      type: 'answer',
      questionId: 'q1',
      optionId: 'b',
    });

    expect(started.phase).toBe('questions');
    expect(changed.answers).toEqual({ q1: 'b' });
  });

  it('distinguishes a sensitive skip from an unanswered question', () => {
    const started = assessmentReducer(createAssessmentState(), { type: 'start' });
    const skipped = assessmentReducer(started, { type: 'skip', questionId: 'q1' });

    expect(canAdvance(started, 'q1', true)).toBe(false);
    expect(canAdvance(skipped, 'q1', true)).toBe(true);
    expect(canAdvance(skipped, 'q1', false)).toBe(false);
  });

  it('keeps previous and next navigation within question bounds', () => {
    const started = assessmentReducer(createAssessmentState(), { type: 'start' });
    const beforeFirst = assessmentReducer(started, { type: 'previous' });
    const second = assessmentReducer(started, { type: 'next', lastIndex: 1 });
    const afterLast = assessmentReducer(second, { type: 'next', lastIndex: 1 });

    expect(beforeFirst.currentIndex).toBe(0);
    expect(second.currentIndex).toBe(1);
    expect(afterLast.currentIndex).toBe(1);
  });

  it('finishes and restarts with a fresh state', () => {
    const answered = assessmentReducer(
      assessmentReducer(createAssessmentState(), { type: 'start' }),
      { type: 'answer', questionId: 'q1', optionId: 'a' },
    );
    const finished = assessmentReducer(answered, { type: 'finish' });

    expect(finished.phase).toBe('result');
    expect(assessmentReducer(finished, { type: 'restart' })).toEqual(createAssessmentState());
  });

  it('restores a saved draft at its last answered question', () => {
    const restored = assessmentReducer(createAssessmentState(), {
      type: 'restore',
      currentIndex: 4,
      answers: { q1: 'a', q2: null },
    });

    expect(restored).toEqual({
      phase: 'questions',
      currentIndex: 4,
      answers: { q1: 'a', q2: null },
    });
  });
});
