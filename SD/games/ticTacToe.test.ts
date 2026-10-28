import { describe, expect, it } from 'vitest';

import {
  applyTicTacToeMove,
  createTicTacToeState,
  getTicTacToeLegalMoves,
  type TicTacToeState,
} from './ticTacToe';

describe('tic-tac-toe rules', () => {
  it('starts with an empty board and X to move', () => {
    expect(createTicTacToeState()).toEqual({
      board: Array(9).fill(null),
      currentPlayer: 'X',
      status: 'playing',
      winner: null,
      winningLine: [],
    });
  });

  it('applies a legal move and switches players', () => {
    const next = applyTicTacToeMove(createTicTacToeState(), 4);

    expect(next.board[4]).toBe('X');
    expect(next.currentPlayer).toBe('O');
    expect(next.status).toBe('playing');
    expect(getTicTacToeLegalMoves(next)).toHaveLength(8);
  });

  it('detects a row winner and records the winning line', () => {
    let state = createTicTacToeState();
    for (const move of [0, 3, 1, 4, 2]) {
      state = applyTicTacToeMove(state, move);
    }

    expect(state.status).toBe('won');
    expect(state.winner).toBe('X');
    expect(state.winningLine).toEqual([0, 1, 2]);
    expect(getTicTacToeLegalMoves(state)).toEqual([]);
  });

  it('detects a diagonal winner for either player', () => {
    let state = createTicTacToeState();
    for (const move of [0, 1, 4, 2, 8]) {
      state = applyTicTacToeMove(state, move);
    }

    expect(state.status).toBe('won');
    expect(state.winner).toBe('X');
    expect(state.winningLine).toEqual([0, 4, 8]);
  });

  it('detects a draw when the board is full without a winner', () => {
    let state: TicTacToeState = createTicTacToeState();
    for (const move of [0, 1, 2, 4, 3, 5, 7, 6, 8]) {
      state = applyTicTacToeMove(state, move);
    }

    expect(state.status).toBe('draw');
    expect(state.winner).toBeNull();
    expect(state.winningLine).toEqual([]);
    expect(getTicTacToeLegalMoves(state)).toEqual([]);
  });

  it('rejects out-of-range, occupied, and post-game moves', () => {
    const first = applyTicTacToeMove(createTicTacToeState(), 0);

    expect(() => applyTicTacToeMove(first, 0)).toThrow('非法落子');
    expect(() => applyTicTacToeMove(first, -1)).toThrow('非法落子');
    expect(() => applyTicTacToeMove(first, 9)).toThrow('非法落子');

    let won = createTicTacToeState();
    for (const move of [0, 3, 1, 4, 2]) {
      won = applyTicTacToeMove(won, move);
    }
    expect(() => applyTicTacToeMove(won, 5)).toThrow('对局已结束');
  });
});
