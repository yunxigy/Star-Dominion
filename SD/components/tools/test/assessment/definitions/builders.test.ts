import { describe, expect, it } from 'vitest';

import { agreementOptions, pairedTendencyOptions } from './builders';

describe('assessment option builders', () => {
  it('builds positive and reverse agreement scales without shared mutation', () => {
    const positive = agreementOptions('calm');
    const reverse = agreementOptions('calm', true);

    expect(positive.map((option) => option.scores.calm)).toEqual([0, 1, 2, 3, 4]);
    expect(reverse.map((option) => option.scores.calm)).toEqual([4, 3, 2, 1, 0]);
    positive[0].label = 'changed';
    expect(agreementOptions('calm')[0].label).toBe('非常不同意');
  });

  it('builds a complementary five-point paired scale', () => {
    const options = pairedTendencyOptions('E', 'I');

    expect(options).toHaveLength(5);
    expect(options.map((option) => option.scores.E)).toEqual([4, 3, 2, 1, 0]);
    expect(options.map((option) => option.scores.I)).toEqual([0, 1, 2, 3, 4]);
  });
});
