import { describe, expect, it } from 'vitest';

import {
  buildLotteryPool,
  drawWinners,
  getWheelRotation,
  getAvailableLotteryEntries,
  getLotteryShareText,
  LOTTERY_PRESETS,
  parseLotteryEntries,
} from './lottery';

describe('lottery helpers', () => {
  it('parses blank lines and comma-separated entries', () => {
    expect(parseLotteryEntries('  张三\n\n李四, 王五，赵六  ')).toEqual(['张三', '李四', '王五', '赵六']);
  });

  it('can deduplicate a lottery pool without mutating the source', () => {
    const entries = ['A', 'B', 'A', 'C'];

    expect(buildLotteryPool(entries, true)).toEqual(['A', 'B', 'C']);
    expect(buildLotteryPool(entries, false)).toEqual(entries);
    expect(entries).toEqual(['A', 'B', 'A', 'C']);
  });

  it('draws several winners without replacement and clamps the count', () => {
    const randomValues = [0, 0.99, 0.4];
    const random = () => randomValues.shift() ?? 0;

    expect(drawWinners(['A', 'B', 'C'], 8, random)).toEqual(['A', 'C', 'B']);
  });

  it('returns an extra clockwise rotation that places the selected segment under the pointer', () => {
    expect(getWheelRotation(0, 4, 0, 4)).toBe(1755);
    expect(getWheelRotation(2, 8, 720, 3)).toBeGreaterThan(720);
  });

  it('exposes scenario presets and removes eliminated entries from later rounds', () => {
    expect(LOTTERY_PRESETS.map((preset) => preset.id)).toEqual([
      'classroom',
      'party',
      'tasks',
    ]);
    expect(getAvailableLotteryEntries(['A', 'B', 'A', 'C'], ['A'])).toEqual(['B', 'C']);
  });

  it('formats a compact share summary for a completed draw', () => {
    expect(getLotteryShareText(['小红', '小明'], 'wheel', '20:18')).toBe(
      '幸运转盘抽奖结果（20:18）\n第 1 名：小红\n第 2 名：小明',
    );
  });
});
