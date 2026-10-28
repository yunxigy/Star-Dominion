import { describe, expect, it } from 'vitest';

import { applyConnectFourMove, createConnectFourState } from './connectFour';
import { chooseConnectFourMove, type ConnectFourDifficulty } from './connectFourAi';

function stateAfter(columns: number[]) {
  return columns.reduce(applyConnectFourMove, createConnectFourState());
}

describe('connect-four AI', () => {
  it.each<ConnectFourDifficulty>(['easy', 'normal', 'hard'])('returns a legal column on %s difficulty', difficulty => {
    const state = stateAfter([0, 1]);
    const move = chooseConnectFourMove(state, difficulty);

    expect(move).toBeGreaterThanOrEqual(0);
    expect(move).toBeLessThanOrEqual(6);
  });

  it('takes an immediate winning column', () => {
    const state = stateAfter([0, 6, 1, 6, 2, 6]);

    expect(chooseConnectFourMove(state, 'hard')).toBe(3);
  });

  it('blocks an immediate opponent win', () => {
    const state = stateAfter([0, 6, 1, 6, 2]);

    expect(chooseConnectFourMove(state, 'hard')).toBe(3);
  });

  it('returns null after a winning move ends the game', () => {
    const state = stateAfter([0, 6, 1, 6, 2, 6, 3]);

    expect(chooseConnectFourMove(state, 'hard')).toBeNull();
  });
});
