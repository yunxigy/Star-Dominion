import { describe, expect, it } from 'vitest';

import { createXiangqiState } from './xiangqi';
import { chooseXiangqiMove, type XiangqiDifficulty } from './xiangqiAi';

describe('xiangqi AI', () => {
  it.each<XiangqiDifficulty>(['easy', 'normal', 'hard'])('returns a legal opening move on %s difficulty', difficulty => {
    const move = chooseXiangqiMove(createXiangqiState(), difficulty);

    expect(move).toBeTruthy();
    expect(move?.from).toBeGreaterThanOrEqual(0);
    expect(move?.to).toBeLessThan(90);
  });

  it('returns null for a terminal position', () => {
    const state = { ...createXiangqiState(), status: 'checkmate' as const, winner: 'red' as const };
    expect(chooseXiangqiMove(state, 'hard')).toBeNull();
  });
});
