import { describe, expect, it } from 'vitest';

import {
  getAssessmentVariant,
  getAssessmentVariants,
  withAssessmentModes,
} from './modes';
import type { AssessmentDefinition } from './types';

const definition: AssessmentDefinition = {
  id: 'mode-fixture',
  title: '模式测试',
  subtitle: '模式测试',
  group: 'personality',
  questionCount: 4,
  estimatedMinutes: 4,
  mode: 'dominant',
  sensitive: false,
  intro: '模式测试',
  disclaimer: '模式测试',
  minAnsweredRatio: 1,
  dimensions: [
    { id: 'a', label: 'A', color: '#111111', description: 'A' },
  ],
  questions: [
    { id: 'q1', prompt: 'Q1', options: [{ id: 'yes', label: '是', scores: { a: 1 } }, { id: 'no', label: '否', scores: {} }] },
    { id: 'q2', prompt: 'Q2', options: [{ id: 'yes', label: '是', scores: { a: 1 } }, { id: 'no', label: '否', scores: {} }] },
    { id: 'q3', prompt: 'Q3', options: [{ id: 'yes', label: '是', scores: { a: 1 } }, { id: 'no', label: '否', scores: {} }] },
    { id: 'q4', prompt: 'Q4', options: [{ id: 'yes', label: '是', scores: { a: 1 } }, { id: 'no', label: '否', scores: {} }] },
  ],
  results: [
    { id: 'a', title: 'A', description: 'A', keywords: ['A'] },
  ],
  tieBreakOrder: ['a'],
};

describe('assessment modes', () => {
  it('creates a quick variant without changing the complete question order', () => {
    const expanded = withAssessmentModes(definition, ['q3', 'q1'], 2);
    const variants = getAssessmentVariants(expanded);

    expect(variants.map((variant) => variant.id)).toEqual(['quick', 'complete']);
    expect(variants[0]).toMatchObject({
      label: '简易测试',
      estimatedMinutes: 2,
      questions: [definition.questions[2], definition.questions[0]],
    });
    expect(variants[1].questions).toEqual(definition.questions);
    expect(expanded.questions).toEqual(definition.questions);
  });

  it('falls back to a complete variant for definitions without modes', () => {
    expect(getAssessmentVariant(definition, 'complete').questions).toEqual(definition.questions);
    expect(getAssessmentVariants(definition)).toHaveLength(1);
  });
});
