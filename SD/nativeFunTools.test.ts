import { describe, expect, it } from 'vitest';
import {
  drawUnique,
  generatePassword,
  randomInt,
  rollDice,
} from '../xiaochengxu/miniprogram/utils/random';

describe('native fun tool logic', () => {
  it('keeps random numbers and dice inside requested bounds', () => {
    expect(randomInt(1, 6, () => 0.999999)).toBe(6);
    expect(randomInt(6, 1, () => 0)).toBe(1);
    expect(rollDice(4, 6, () => 0.999999)).toEqual([6, 6, 6, 6]);
  });

  it('generates passwords that include every requested character class', () => {
    const result = generatePassword(16, {
      lowercase: true,
      uppercase: true,
      numbers: true,
      symbols: true,
    }, () => 0.17);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(16);
      expect(result.value).toMatch(/[a-z]/);
      expect(result.value).toMatch(/[A-Z]/);
      expect(result.value).toMatch(/[0-9]/);
      expect(result.value).toMatch(/[!@#$%^&*]/);
    }
    expect(generatePassword(2, { lowercase: true, uppercase: true, numbers: true, symbols: true }).ok).toBe(false);
  });

  it('draws unique winners without mutating the source list', () => {
    const entries = ['甲', '乙', '丙'];
    expect(drawUnique(entries, 2, () => 0)).toEqual(['甲', '乙']);
    expect(entries).toEqual(['甲', '乙', '丙']);
  });
});
