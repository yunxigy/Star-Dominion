import { describe, expect, it } from 'vitest';

import { validateAssessmentDefinition } from '../definitionValidation';
import { scoreAssessment } from '../scoring';
import type { AnswerMap, AssessmentDefinition } from '../types';
import { communicationStyleDefinition } from './communicationStyle';
import { coreValuesDefinition } from './coreValues';
import { emotionalIntelligenceDefinition } from './emotionalIntelligence';

const definitions = [
  communicationStyleDefinition,
  emotionalIntelligenceDefinition,
  coreValuesDefinition,
];

function answersFavoring(definition: AssessmentDefinition, dimensionId: string): AnswerMap {
  return Object.fromEntries(definition.questions.map((question) => {
    const best = [...question.options].sort(
      (left, right) => (right.scores[dimensionId] ?? 0) - (left.scores[dimensionId] ?? 0),
    )[0];
    return [question.id, best.id];
  }));
}

describe('personality assessment definitions', () => {
  it('provides three valid 24-question personality definitions', () => {
    for (const definition of definitions) {
      expect(validateAssessmentDefinition(definition)).toEqual([]);
      expect(definition.group).toBe('personality');
      expect(definition.questions).toHaveLength(24);
      expect(definition.results.every((result) => result.keywords.length >= 3 && result.keywords.length <= 5)).toBe(true);
    }
  });

  it('makes every communication style reachable', () => {
    expect(communicationStyleDefinition.dimensions).toHaveLength(4);
    for (const dimension of communicationStyleDefinition.dimensions) {
      const result = scoreAssessment(
        communicationStyleDefinition,
        answersFavoring(communicationStyleDefinition, dimension.id),
      );
      expect(result.primaryResultId).toBe(dimension.id);
    }
  });

  it('covers every emotional-intelligence dimension with positive and reverse items', () => {
    expect(emotionalIntelligenceDefinition.mode).toBe('dimensions');
    for (const dimension of emotionalIntelligenceDefinition.dimensions) {
      const linked = emotionalIntelligenceDefinition.questions.filter((question) =>
        question.options.some((option) => dimension.id in option.scores));
      const reverse = linked.filter((question) =>
        (question.options[0].scores[dimension.id] ?? 0)
          >
          (question.options[question.options.length - 1]?.scores[dimension.id] ??
            0));
      expect(linked.length).toBeGreaterThanOrEqual(4);
      expect(reverse.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('balances and reaches all six core values', () => {
    expect(coreValuesDefinition.dimensions).toHaveLength(6);
    for (const dimension of coreValuesDefinition.dimensions) {
      const primaryCount = coreValuesDefinition.questions
        .flatMap((question) => question.options)
        .filter((option) => option.scores[dimension.id] === 2)
        .length;
      expect(primaryCount).toBe(16);
      expect(scoreAssessment(coreValuesDefinition, answersFavoring(coreValuesDefinition, dimension.id)).primaryResultId)
        .toBe(dimension.id);
    }
  });
});
