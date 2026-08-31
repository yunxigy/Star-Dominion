import { describe, expect, it } from 'vitest';

import { getDiceTotal, rollDice } from './dice';

describe('dice helpers', () => {
  it('rolls the requested number of dice within the selected sides', () => {
    const randomValues = [0, 0.5, 0.999];
    const random = () => randomValues.shift() ?? 0;

    expect(rollDice(3, 6, random)).toEqual([1, 4, 6]);
  });

  it('clamps invalid dice settings to a safe playable range', () => {
    expect(rollDice(0, 1, () => 0.5)).toHaveLength(1);
    expect(rollDice(99, 99, () => 0)).toHaveLength(12);
    expect(rollDice(1, 1, () => 0.5)).toEqual([2]);
  });

  it('calculates the sum of a roll', () => {
    expect(getDiceTotal([2, 5, 6])).toBe(13);
    expect(getDiceTotal([])).toBe(0);
  });
});
