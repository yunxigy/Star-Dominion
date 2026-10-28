import { describe, expect, it } from 'vitest';

import { validateAssessmentDefinition } from '../definitionValidation';
import { scoreAssessment } from '../scoring';
import { mbtiDefinition } from './mbti';

describe('MBTI 40-question definition', () => {
  it('declares four balanced pairs and all 16 result profiles', () => {
    expect(validateAssessmentDefinition(mbtiDefinition)).toEqual([]);
    expect(mbtiDefinition.questions).toHaveLength(40);
    expect(mbtiDefinition.results).toHaveLength(16);
    expect(mbtiDefinition.mbtiPairs).toHaveLength(4);

    for (const pair of mbtiDefinition.mbtiPairs ?? []) {
      const linked = mbtiDefinition.questions.filter((question) =>
        question.options.every(
          (option) => pair.left in option.scores && pair.right in option.scores,
        ),
      );
      expect(linked).toHaveLength(10);
    }
  });

  it('scores answers favoring each pair left as ESTJ and right as INFP', () => {
    const pairForQuestion = (questionId: string) =>
      mbtiDefinition.mbtiPairs?.find((pair) =>
        questionId.toUpperCase().startsWith(pair.id),
      );
    const answersFavoring = (side: 'left' | 'right') =>
      Object.fromEntries(
        mbtiDefinition.questions.map((question) => {
          const pair = pairForQuestion(question.id);
          const dimensionId = pair?.[side] ?? '';
          const best = [...question.options].sort(
            (left, right) =>
              (right.scores[dimensionId] ?? 0) -
              (left.scores[dimensionId] ?? 0),
          )[0];
          return [question.id, best.id];
        }),
      );

    expect(scoreAssessment(mbtiDefinition, answersFavoring('left')).mbtiType).toBe('ESTJ');
    expect(scoreAssessment(mbtiDefinition, answersFavoring('right')).mbtiType).toBe('INFP');
  });

  it('uses pair tie questions and reports neutral boundaries', () => {
    const neutral = Object.fromEntries(
      mbtiDefinition.questions.map((question) => [question.id, 'neutral']),
    );
    const result = scoreAssessment(mbtiDefinition, neutral);

    expect(result.mbtiType).toBe('ESTJ');
    expect(result.closeDimensionIds).toEqual(['EI', 'SN', 'TF', 'JP']);
  });
});
