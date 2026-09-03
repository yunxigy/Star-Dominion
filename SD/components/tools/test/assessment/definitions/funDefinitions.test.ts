import { describe, expect, it } from 'vitest';

import { validateAssessmentDefinition } from '../definitionValidation';
import { scoreAssessment } from '../scoring';
import type { AnswerMap, AssessmentDefinition } from '../types';
import { animalPersonalityDefinition } from './animalPersonality';
import { colorPersonalityDefinition } from './colorPersonality';
import { lifeEnergyDefinition } from './lifeEnergy';

const definitions = [
  animalPersonalityDefinition,
  colorPersonalityDefinition,
  lifeEnergyDefinition,
];

function answersFavoring(definition: AssessmentDefinition, dimensionId: string): AnswerMap {
  return Object.fromEntries(definition.questions.map((question) => {
    const best = [...question.options].sort(
      (left, right) => (right.scores[dimensionId] ?? 0) - (left.scores[dimensionId] ?? 0),
    )[0];
    return [question.id, best.id];
  }));
}

describe('fun assessment definitions', () => {
  it('provides three valid 24-question local definitions', () => {
    for (const definition of definitions) {
      expect(validateAssessmentDefinition(definition)).toEqual([]);
      expect(definition.group).toBe('fun');
      expect(definition.mode).toBe('dominant');
      expect(definition.sensitive).toBe(false);
      expect(definition.questions).toHaveLength(24);
      expect(definition.results).toHaveLength(6);
    }
  });

  it('balances each result as a primary option sixteen times', () => {
    for (const definition of definitions) {
      for (const dimension of definition.dimensions) {
        const primaryCount = definition.questions
          .flatMap((question) => question.options)
          .filter((option) => option.scores[dimension.id] === 2)
          .length;
        expect(primaryCount, `${definition.id}/${dimension.id}`).toBe(16);
      }
    }
  });

  it('can make every configured result the primary result', () => {
    for (const definition of definitions) {
      for (const dimension of definition.dimensions) {
        const result = scoreAssessment(definition, answersFavoring(definition, dimension.id));
        expect(result.primaryResultId, `${definition.id}/${dimension.id}`).toBe(dimension.id);
      }
    }
  });
});
