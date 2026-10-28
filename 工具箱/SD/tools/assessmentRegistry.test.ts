import { describe, expect, it } from 'vitest';

import { getToolsByCategory, getToolById, TOOLS } from './registry';

const assessmentMetadata: Record<string, { group: 'fun' | 'personality' | 'orientation'; quick: number; complete: number; minutes: number }> = {
  'mbti-test': { group: 'personality', quick: 16, complete: 40, minutes: 8 },
  'big-five-test': { group: 'personality', quick: 10, complete: 25, minutes: 7 },
  'enneagram-test': { group: 'personality', quick: 9, complete: 27, minutes: 8 },
  'attachment-style-test': { group: 'personality', quick: 8, complete: 24, minutes: 7 },
  'love-language-test': { group: 'personality', quick: 10, complete: 25, minutes: 7 },
  'career-interest-test': { group: 'personality', quick: 12, complete: 24, minutes: 7 },
  'disc-test': { group: 'personality', quick: 8, complete: 24, minutes: 7 },
  'procrastination-test': { group: 'personality', quick: 8, complete: 24, minutes: 7 },
  'social-anxiety-test': { group: 'personality', quick: 8, complete: 24, minutes: 7 },
  'learning-style-test': { group: 'personality', quick: 8, complete: 24, minutes: 7 },
  'emotional-stability-test': { group: 'personality', quick: 8, complete: 24, minutes: 7 },
  'animal-personality-test': { group: 'fun', quick: 12, complete: 24, minutes: 6 },
  'color-personality-test': { group: 'fun', quick: 12, complete: 24, minutes: 6 },
  'life-energy-test': { group: 'fun', quick: 12, complete: 24, minutes: 6 },
  'communication-style-test': { group: 'personality', quick: 12, complete: 24, minutes: 6 },
  'emotional-intelligence-test': { group: 'personality', quick: 12, complete: 24, minutes: 6 },
  'core-values-test': { group: 'personality', quick: 12, complete: 24, minutes: 7 },
  'orientation-spectrum-test': { group: 'orientation', quick: 12, complete: 24, minutes: 6 },
  'romantic-orientation-test': { group: 'orientation', quick: 12, complete: 24, minutes: 6 },
  'intimacy-boundaries-test': { group: 'orientation', quick: 12, complete: 24, minutes: 6 },
  'brain-power-test': { group: 'fun', quick: 12, complete: 24, minutes: 8 },
  'intelligence-test': { group: 'fun', quick: 12, complete: 24, minutes: 8 },
};

describe('expanded assessment registry', () => {
  it('registers 23 assessment tools and the current full toolbox', () => {
    expect(TOOLS).toHaveLength(215);
    expect(getToolsByCategory('test')).toHaveLength(23);
  });

  it('publishes complete local metadata for every expanded assessment', () => {
    for (const [id, metadata] of Object.entries(assessmentMetadata)) {
      const tool = getToolById(id);
      expect(tool).toMatchObject({
        category: 'test',
        privacy: 'local',
        status: 'stable',
        assessmentGroup: metadata.group,
        questionCount: metadata.complete,
        quickQuestionCount: metadata.quick,
        estimatedMinutes: metadata.minutes,
      });
      expect(tool?.quickEstimatedMinutes).toBeGreaterThanOrEqual(2);
      expect(tool?.quickEstimatedMinutes).toBeLessThanOrEqual(metadata.minutes);
    }
  });

  it('updates MBTI to the 40-question personality edition', () => {
    expect(getToolById('mbti-test')).toMatchObject({
      name: 'MBTI 40 题扩展版',
      assessmentGroup: 'personality',
      questionCount: 40,
      quickQuestionCount: 16,
      estimatedMinutes: 8,
      sensitive: false,
    });
  });

  it('registers the interactive brain gym as a challenge instead of a questionnaire', () => {
    expect(getToolById('brain-gym')).toMatchObject({
      name: '脑力挑战台',
      category: 'test',
      privacy: 'local',
      status: 'stable',
      assessmentGroup: 'fun',
      assessmentKind: 'challenge',
    });
  });
});
