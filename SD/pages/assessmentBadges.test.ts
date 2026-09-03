import { describe, expect, test } from 'vitest';

import { getAssessmentBadges } from './assessmentBadges';

describe('assessment badges', () => {
  test('always provides a category badge for assessments without metadata', () => {
    expect(getAssessmentBadges(undefined).map((badge) => badge.label)).toEqual(['综合测评']);
  });

  test('adds question and time badges when metadata exists', () => {
    expect(getAssessmentBadges('fun', 18, 4).map((badge) => badge.label)).toEqual(['趣味测评', '18 题', '约 4 分钟']);
  });

  test('shows both available lengths when quick metadata exists', () => {
    expect(getAssessmentBadges('fun', 24, 6, 12, 3).map((badge) => badge.label)).toEqual([
      '趣味测评', '简易 12 题 · 约 3 分钟', '完整 24 题 · 约 6 分钟',
    ]);
  });

  test('labels interactive brain challenges without pretending they are questionnaires', () => {
    expect(getAssessmentBadges('fun', undefined, undefined, undefined, undefined, 'challenge').map((badge) => badge.label)).toEqual([
      '趣味测评', '互动挑战',
    ]);
  });
});
