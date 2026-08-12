import { describe, expect, test } from 'vitest';

import { getAssessmentBadges } from './assessmentBadges';

describe('assessment badges', () => {
  test('always provides a category badge for assessments without metadata', () => {
    expect(getAssessmentBadges(undefined).map((badge) => badge.label)).toEqual(['综合测评']);
  });

  test('adds question and time badges when metadata exists', () => {
    expect(getAssessmentBadges('fun', 18, 4).map((badge) => badge.label)).toEqual(['趣味测评', '18 题', '约 4 分钟']);
  });
});
