import { describe, expect, it } from 'vitest';

import { createGomokuState, GOMOKU_SIZE, type GomokuState } from './gomoku';
import { chooseGomokuMove, type GomokuDifficulty } from './gomokuAi';

function stateWithStones(stones: Array<[number, 'black' | 'white']>, currentPlayer: 'black' | 'white' = 'black'): GomokuState {
  const state = createGomokuState();
  const board = [...state.board];
  stones.forEach(([index, player]) => {
    board[index] = player;
  });
  return { ...state, board, currentPlayer };
}

describe('gomoku AI', () => {
  it.each<GomokuDifficulty>(['easy', 'normal', 'hard'])('returns a legal move on %s difficulty', difficulty => {
    const move = chooseGomokuMove(createGomokuState(), difficulty);

    expect(move).toBeGreaterThanOrEqual(0);
    expect(move).toBeLessThan(GOMOKU_SIZE * GOMOKU_SIZE);
  });

  it('opens in the center when the board is empty', () => {
    expect(chooseGomokuMove(createGomokuState(), 'normal')).toBe(7 * GOMOKU_SIZE + 7);
  });

  it('takes an immediate winning move', () => {
    const rowStart = 7 * GOMOKU_SIZE;
    const state = stateWithStones([
      [rowStart + 3, 'black'],
      [rowStart + 4, 'black'],
      [rowStart + 5, 'black'],
      [rowStart + 6, 'black'],
      [rowStart + 7, 'white'],
    ]);

    expect(chooseGomokuMove(state, 'hard')).toBe(rowStart + 2);
  });

  it('blocks an immediate opponent win', () => {
    const rowStart = 7 * GOMOKU_SIZE;
    const state = stateWithStones([
      [rowStart + 3, 'white'],
      [rowStart + 4, 'white'],
      [rowStart + 5, 'white'],
      [rowStart + 6, 'white'],
      [rowStart + 7, 'black'],
    ]);

    expect(chooseGomokuMove(state, 'hard')).toBe(rowStart + 2);
  });

  it('returns null after the game has ended', () => {
    const state = stateWithStones([
      [7 * GOMOKU_SIZE + 2, 'black'],
      [7 * GOMOKU_SIZE + 3, 'black'],
      [7 * GOMOKU_SIZE + 4, 'black'],
      [7 * GOMOKU_SIZE + 5, 'black'],
      [7 * GOMOKU_SIZE + 6, 'black'],
    ]);

    expect(chooseGomokuMove({ ...state, status: 'won', winner: 'black' }, 'hard')).toBeNull();
  });
});
