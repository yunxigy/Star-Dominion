import { describe, expect, it } from 'vitest';

import {
  applyGomokuMove,
  createGomokuState,
  GOMOKU_SIZE,
  getGomokuLegalMoves,
  type GomokuState,
} from './gomoku';

function stateWithStones(stones: Array<[number, 'black' | 'white']>): GomokuState {
  const state = createGomokuState();
  const board = [...state.board];
  stones.forEach(([index, player]) => {
    board[index] = player;
  });
  return { ...state, board };
}

describe('gomoku rules', () => {
  it('starts with a 15 by 15 board and black to move', () => {
    const state = createGomokuState();

    expect(state.board).toHaveLength(GOMOKU_SIZE * GOMOKU_SIZE);
    expect(state.currentPlayer).toBe('black');
    expect(state.status).toBe('playing');
    expect(state.winner).toBeNull();
    expect(getGomokuLegalMoves(state)).toHaveLength(225);
  });

  it('places a stone and detects a horizontal five', () => {
    const rowStart = 7 * GOMOKU_SIZE;
    const state = stateWithStones([
      [rowStart + 2, 'black'],
      [rowStart + 3, 'black'],
      [rowStart + 4, 'black'],
      [rowStart + 5, 'black'],
    ]);

    const next = applyGomokuMove(state, rowStart + 6);

    expect(next.board[rowStart + 6]).toBe('black');
    expect(next.status).toBe('won');
    expect(next.winner).toBe('black');
    expect(next.winningLine).toEqual([rowStart + 2, rowStart + 3, rowStart + 4, rowStart + 5, rowStart + 6]);
    expect(getGomokuLegalMoves(next)).toEqual([]);
  });

  it('detects a diagonal five', () => {
    const state = stateWithStones([
      [6 * GOMOKU_SIZE + 4, 'white'],
      [7 * GOMOKU_SIZE + 5, 'white'],
      [8 * GOMOKU_SIZE + 6, 'white'],
      [9 * GOMOKU_SIZE + 7, 'white'],
    ]);

    const next = applyGomokuMove({ ...state, currentPlayer: 'white' }, 10 * GOMOKU_SIZE + 8);

    expect(next.status).toBe('won');
    expect(next.winner).toBe('white');
    expect(next.winningLine).toEqual([
      6 * GOMOKU_SIZE + 4,
      7 * GOMOKU_SIZE + 5,
      8 * GOMOKU_SIZE + 6,
      9 * GOMOKU_SIZE + 7,
      10 * GOMOKU_SIZE + 8,
    ]);
  });

  it('rejects invalid, occupied, and post-game moves', () => {
    const state = createGomokuState();
    expect(() => applyGomokuMove(state, -1)).toThrow('非法落子');
    expect(() => applyGomokuMove(state, GOMOKU_SIZE * GOMOKU_SIZE)).toThrow('非法落子');

    const occupied = applyGomokuMove(state, 0);
    expect(() => applyGomokuMove(occupied, 0)).toThrow('非法落子');

    const rowStart = 7 * GOMOKU_SIZE;
    const won = applyGomokuMove(stateWithStones([
      [rowStart + 2, 'black'],
      [rowStart + 3, 'black'],
      [rowStart + 4, 'black'],
      [rowStart + 5, 'black'],
    ]), rowStart + 6);
    expect(() => applyGomokuMove(won, 1)).toThrow('对局已结束');
  });
});
