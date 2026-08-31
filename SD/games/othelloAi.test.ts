import { describe, expect, it } from 'vitest';

import { createOthelloState } from './othello';
import { chooseOthelloMove, type OthelloDifficulty } from './othelloAi';

describe('othello AI', () => {
  it.each<OthelloDifficulty>(['easy', 'normal', 'hard'])('returns a legal move on %s difficulty', difficulty => {
    const state = createOthelloState();
    const move = chooseOthelloMove(state, difficulty);

    expect([19, 26, 37, 44]).toContain(move);
  });

  it('returns null when the current player has no move', () => {
    const state = {
      ...createOthelloState(),
      board: Array(64).fill('black') as Array<'black' | 'white' | null>,
      currentPlayer: 'white' as const,
    };

    expect(chooseOthelloMove(state, 'hard')).toBeNull();
  });
});
