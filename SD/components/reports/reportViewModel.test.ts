import { describe, expect, it } from 'vitest';

import { toRankSignal } from './reportViewModel';


describe('research report view model', () => {
  it('formats rank movement without relying on color', () => {
    expect(toRankSignal({ rank: 2, previousIssueRank: 5, status: 'rising' }))
      .toEqual({ label: '上升 3 位', icon: 'up', delta: 3 });
  });

  it('labels new and returned repositories explicitly', () => {
    expect(toRankSignal({ rank: 1, previousIssueRank: null, status: 'new' }).label)
      .toBe('新上榜');
    expect(toRankSignal({ rank: 8, previousIssueRank: null, status: 'returned' }).label)
      .toBe('重新上榜');
  });
});
