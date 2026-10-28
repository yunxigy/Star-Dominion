import { describe, expect, it } from 'vitest';

import { validateAssessmentDefinition } from '../definitionValidation';
import { scoreAssessment } from '../scoring';
import type { AnswerMap, AssessmentDefinition } from '../types';
import { intimacyBoundariesDefinition } from './intimacyBoundaries';
import { orientationSpectrumDefinition } from './orientationSpectrum';
import { romanticOrientationDefinition } from './romanticOrientation';

const definitions = [
  orientationSpectrumDefinition,
  romanticOrientationDefinition,
  intimacyBoundariesDefinition,
];

function answersFavoring(
  definition: AssessmentDefinition,
  dimensionId: string,
): AnswerMap {
  return Object.fromEntries(
    definition.questions.map((question) => {
      const best = [...question.options].sort(
        (left, right) =>
          (right.scores[dimensionId] ?? 0) -
          (left.scores[dimensionId] ?? 0),
      )[0];
      return [question.id, best.id];
    }),
  );
}

describe('orientation and intimacy assessment definitions', () => {
  it('provides three valid 24-question sensitive definitions', () => {
    for (const definition of definitions) {
      expect(validateAssessmentDefinition(definition)).toEqual([]);
      expect(definition.group).toBe('orientation');
      expect(definition.questions).toHaveLength(24);
      expect(definition.sensitive).toBe(true);
      expect(definition.intro).toContain('16+');
      expect(definition.disclaimer).toContain('仅供自我探索');
      expect(definition.disclaimer).toContain('不用于确认或诊断身份');
    }
  });

  it('avoids behavior-history and trauma questions', () => {
    for (const definition of definitions) {
      const prompts = definition.questions.map((question) => question.prompt).join('\n');
      expect(prompts).not.toMatch(/性行为|伴侣数量|性经历|创伤经历/);
    }
  });

  it('allows skipping while withholding under-covered dimensions', () => {
    for (const definition of definitions) {
      const sparseAnswers: AnswerMap = {
        [definition.questions[0].id]: definition.questions[0].options[0].id,
      };
      const sparse = scoreAssessment(definition, sparseAnswers);
      expect(sparse.insufficientDimensionIds.length).toBeGreaterThan(0);

      const completeAnswers = Object.fromEntries(
        definition.questions.map((question) => [question.id, question.options[0].id]),
      );
      const complete = scoreAssessment(definition, completeAnswers);
      expect(complete.insufficientDimensionIds).toEqual([]);
    }
  });

  it('makes every intimacy-boundary style reachable without ranking healthiness', () => {
    expect(intimacyBoundariesDefinition.disclaimer).toContain('没有哪一种更健康或更成熟');
    for (const dimension of intimacyBoundariesDefinition.dimensions) {
      expect(
        scoreAssessment(
          intimacyBoundariesDefinition,
          answersFavoring(intimacyBoundariesDefinition, dimension.id),
        ).primaryResultId,
      ).toBe(dimension.id);
    }
  });
});
