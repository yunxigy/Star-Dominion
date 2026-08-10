import { describe, expect, it } from 'vitest';

import { validateAssessmentDefinition } from '../definitionValidation';
import { scoreAssessment } from '../scoring';
import type { AnswerMap, AssessmentDefinition } from '../types';
import { ASSESSMENT_DEFINITIONS } from '.';

const expectedIds = [
  'animal-personality-test',
  'color-personality-test',
  'life-energy-test',
  'communication-style-test',
  'emotional-intelligence-test',
  'core-values-test',
  'orientation-spectrum-test',
  'romantic-orientation-test',
  'intimacy-boundaries-test',
  'mbti-test',
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

describe('complete assessment definition registry', () => {
  it('contains exactly the ten expanded definitions with valid contracts', () => {
    expect(Object.keys(ASSESSMENT_DEFINITIONS).sort()).toEqual(expectedIds.sort());
    for (const definition of Object.values(ASSESSMENT_DEFINITIONS)) {
      expect(validateAssessmentDefinition(definition)).toEqual([]);
      expect(new Set(definition.questions.map((question) => question.id)).size)
        .toBe(definition.questions.length);
    }
  });

  it('keeps nine new tests at 18 questions and MBTI at 40', () => {
    for (const definition of Object.values(ASSESSMENT_DEFINITIONS)) {
      expect(definition.questions).toHaveLength(
        definition.id === 'mbti-test' ? 40 : 18,
      );
    }
  });

  it('makes every declared dominant result reachable', () => {
    const dominantDefinitions = Object.values(ASSESSMENT_DEFINITIONS).filter(
      (definition) => definition.mode === 'dominant',
    );
    for (const definition of dominantDefinitions) {
      for (const dimension of definition.dimensions) {
        expect(
          scoreAssessment(definition, answersFavoring(definition, dimension.id))
            .primaryResultId,
        ).toBe(dimension.id);
      }
    }
  });

  it('returns complete scores for fully answered dimensions tests', () => {
    const dimensionDefinitions = Object.values(ASSESSMENT_DEFINITIONS).filter(
      (definition) => definition.mode === 'dimensions',
    );
    for (const definition of dimensionDefinitions) {
      const answers = Object.fromEntries(
        definition.questions.map((question) => [question.id, question.options[2].id]),
      );
      expect(scoreAssessment(definition, answers).insufficientDimensionIds).toEqual([]);
    }
  });

  it('marks only the three orientation definitions as sensitive', () => {
    const sensitive = Object.values(ASSESSMENT_DEFINITIONS)
      .filter((definition) => definition.sensitive)
      .map((definition) => definition.id)
      .sort();
    expect(sensitive).toEqual([
      'intimacy-boundaries-test',
      'orientation-spectrum-test',
      'romantic-orientation-test',
    ]);
  });
});
