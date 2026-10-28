import { describe, expect, it } from 'vitest';

import {
  BRAIN_GYM_MODES,
  createNumberMemory,
  createSequenceChallenge,
  formatBrainGymScore,
  getBrainGymGrade,
  isBetterBrainGymScore,
} from './brainGymLogic';

describe('brain gym helpers', () => {
  it('publishes three complementary challenge modes', () => {
    expect(BRAIN_GYM_MODES.map((mode) => mode.id)).toEqual([
      'reaction',
      'number-memory',
      'sequence-memory',
    ]);
  });

  it('creates a deterministic number memory prompt at the requested level', () => {
    expect(createNumberMemory(4, () => 0.42)).toMatchObject({
      value: '444444',
      digits: 6,
      level: 4,
    });
  });

  it('creates unique in-bounds cells for a sequence challenge', () => {
    const sequence = createSequenceChallenge(7, 3, () => 0.2);
    expect(sequence).toHaveLength(7);
    expect(new Set(sequence).size).toBe(7);
    expect(sequence.every((cell) => cell >= 0 && cell < 9)).toBe(true);
  });

  it('formats scores and compares best results according to the mode', () => {
    expect(formatBrainGymScore('reaction', 238)).toBe('238 ms');
    expect(formatBrainGymScore('number-memory', 6)).toBe('6 位数字');
    expect(formatBrainGymScore('sequence-memory', 9)).toBe('9 格序列');
    expect(isBetterBrainGymScore('reaction', 210, 238)).toBe(true);
    expect(isBetterBrainGymScore('sequence-memory', 9, 8)).toBe(true);
    expect(getBrainGymGrade('reaction', 210)).toBe('闪电反应');
    expect(getBrainGymGrade('number-memory', 6)).toBe('记忆小能手');
  });
});
