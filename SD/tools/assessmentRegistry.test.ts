import { describe, expect, it } from 'vitest';

import { getToolsByCategory, getToolById, TOOLS } from './registry';

const newAssessmentIds = [
  'animal-personality-test',
  'color-personality-test',
  'life-energy-test',
  'communication-style-test',
  'emotional-intelligence-test',
  'core-values-test',
  'orientation-spectrum-test',
  'romantic-orientation-test',
  'intimacy-boundaries-test',
];

describe('expanded assessment registry', () => {
  it('registers 20 assessment tools and the current full toolbox', () => {
    expect(TOOLS).toHaveLength(212);
    expect(getToolsByCategory('test')).toHaveLength(20);
  });

  it('publishes complete local metadata for the nine new assessments', () => {
    for (const id of newAssessmentIds) {
      const tool = getToolById(id);
      expect(tool).toMatchObject({
        category: 'test',
        privacy: 'local',
        status: 'stable',
        questionCount: 18,
      });
      expect(tool?.estimatedMinutes).toBeGreaterThanOrEqual(3);
      expect(tool?.estimatedMinutes).toBeLessThanOrEqual(5);
      expect(['fun', 'personality', 'orientation']).toContain(tool?.assessmentGroup);
    }
  });

  it('updates MBTI to the 40-question personality edition', () => {
    expect(getToolById('mbti-test')).toMatchObject({
      name: 'MBTI 40 题扩展版',
      assessmentGroup: 'personality',
      questionCount: 40,
      estimatedMinutes: 8,
      sensitive: false,
    });
  });
});
