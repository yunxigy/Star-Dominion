import { describe, expect, it } from 'vitest';
import {
  getAssessmentDefinition,
  scoreAssessment,
} from '../xiaochengxu/miniprogram/data/assessmentData';
import { drawTarotCards, TAROT_CARDS } from '../xiaochengxu/miniprogram/data/tarotData';

describe('native assessment and tarot logic', () => {
  it('scores answered assessment questions and reports unanswered ones', () => {
    const definition = getAssessmentDefinition('mbti-test');
    const result = scoreAssessment(definition, {
      'mbti-1': 'often',
      'mbti-2': 'often',
    });
    expect(result.answered).toBe(2);
    expect(result.unanswered).toHaveLength(definition.questions.length - 2);
    expect(result.primaryDimension).toBeTruthy();
    expect(result.percentage).toBeGreaterThan(0);
  });

  it('provides a complete tarot deck and draws unique cards', () => {
    expect(TAROT_CARDS).toHaveLength(78);
    const drawn = drawTarotCards(3, () => 0);
    expect(drawn).toHaveLength(3);
    expect(new Set(drawn.map((card) => card.id)).size).toBe(3);
    expect(drawn.every((card) => card.name && card.upright && card.reversed)).toBe(true);
  });
});
