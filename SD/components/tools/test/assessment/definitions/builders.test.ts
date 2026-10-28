import { describe, expect, it } from 'vitest';

import {
  agreementOptions,
  agreementQuestion,
  pairedTendencyOptions,
  scenarioQuestion,
} from './builders';

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

  it('builds four scenario options with primary and secondary scores', () => {
    const question = scenarioQuestion('q1', '周末怎么过？', [
      ['安静阅读', 'cat', 'deer'],
      ['朋友聚会', 'dog', 'otter'],
      ['临时探店', 'fox', 'cat'],
      ['完成计划', 'wolf', 'dog'],
    ]);

    expect(question.options).toHaveLength(4);
    expect(question.options[0].scores).toEqual({ cat: 2, deer: 1 });
    expect(question.options[3].scores).toEqual({ wolf: 2, dog: 1 });
  });

  it('builds a complete agreement question', () => {
    const question = agreementQuestion('q1', '我能觉察情绪。', 'awareness', true);

    expect(question.prompt).toBe('我能觉察情绪。');
    expect(question.options.map((item) => item.scores.awareness)).toEqual([4, 3, 2, 1, 0]);
  });
});
