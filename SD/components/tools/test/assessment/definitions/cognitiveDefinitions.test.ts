import { describe, expect, it } from 'vitest';

import { validateAssessmentDefinition } from '../definitionValidation';
import { scoreAssessment } from '../scoring';
import { brainPowerDefinition, intelligenceDefinition } from './cognitiveDefinitions';

const definitions = [brainPowerDefinition, intelligenceDefinition];

describe('cognitive challenge definitions', () => {
  it('provides quick and complete local challenge sets', () => {
    for (const definition of definitions) {
      expect(validateAssessmentDefinition(definition)).toEqual([]);
      expect(definition.scoreType).toBe('quiz');
      expect(definition.questions).toHaveLength(24);
      expect(definition.variants?.quick?.questions).toHaveLength(12);
      expect(definition.variants?.complete?.questions).toHaveLength(24);
      expect(definition.disclaimer).toContain('不等同于标准化 IQ');
    }
  });

  it('reports an overall accuracy instead of pretending to measure IQ', () => {
    for (const definition of definitions) {
      const answers = Object.fromEntries(definition.questions.map((question) => {
        const correct = question.options.find((option) => Object.values(option.scores).includes(1));
        return [question.id, correct?.id ?? null];
      }));
      const result = scoreAssessment(definition, answers, definition.questions);
      expect(result.overallPercentage).toBe(100);
      expect(result.insufficientDimensionIds).toEqual([]);
    }
  });
});
