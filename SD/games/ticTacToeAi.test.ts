import { describe, expect, it } from 'vitest';

import { applyTicTacToeMove, createTicTacToeState } from './ticTacToe';
import { chooseTicTacToeMove, type TicTacToeDifficulty } from './ticTacToeAi';

function stateAfter(moves: number[]) {
  return moves.reduce(applyTicTacToeMove, createTicTacToeState());
}

describe('tic-tac-toe AI', () => {
  it.each<TicTacToeDifficulty>(['easy', 'normal', 'hard'])('returns a legal move on %s difficulty', (difficulty) => {
    const state = stateAfter([0, 4]);
    const move = chooseTicTacToeMove(state, difficulty);

    expect(move).toBeGreaterThanOrEqual(0);
    expect(state.board[move!]).toBeNull();
  });

  it('takes an immediate winning move on hard difficulty', () => {
    const state = stateAfter([0, 3, 1, 4]);

    expect(chooseTicTacToeMove(state, 'hard')).toBe(2);
  });

  it('blocks an immediate opponent win on hard difficulty', () => {
    const state = stateAfter([0, 4, 1]);

    expect(chooseTicTacToeMove(state, 'hard')).toBe(2);
  });

  it('returns null when the game is already over', () => {
    const state = stateAfter([0, 3, 1, 4, 2]);

    expect(chooseTicTacToeMove(state, 'hard')).toBeNull();
  });
});
