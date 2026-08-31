import { describe, expect, it } from 'vitest';

import {
  applyOthelloMove,
  createOthelloState,
  getOthelloLegalMoves,
  passOthelloTurn,
} from './othello';

describe('othello rules', () => {
  it('starts with the standard four center stones and four black moves', () => {
    const state = createOthelloState();

    expect(state.board).toHaveLength(64);
    expect(state.currentPlayer).toBe('black');
    expect(state.board[27]).toBe('white');
    expect(state.board[28]).toBe('black');
    expect(state.board[35]).toBe('black');
    expect(state.board[36]).toBe('white');
    expect(getOthelloLegalMoves(state).sort((a, b) => a - b)).toEqual([19, 26, 37, 44]);
  });

  it('places a legal stone and flips the bracketed opponent stone', () => {
    const next = applyOthelloMove(createOthelloState(), 19);

    expect(next.board[19]).toBe('black');
    expect(next.board[27]).toBe('black');
    expect(next.currentPlayer).toBe('white');
    expect(next.status).toBe('playing');
    expect(next.winner).toBeNull();
    expect(next.lastMove).toBe(19);
  });

  it('passes when the next player has no legal move', () => {
    const state = {
      ...createOthelloState(),
      board: Array(64).fill('black') as Array<'black' | 'white' | null>,
      currentPlayer: 'white' as const,
    };
    state.board[0] = null;
    state.board[1] = 'white';

    const passed = passOthelloTurn(state);

    expect(passed.status).toBe('playing');
    expect(passed.currentPlayer).toBe('black');
    expect(passed.lastPass).toBe('white');
  });

  it('rejects illegal moves and finishes a full board with a winner', () => {
    const state = createOthelloState();
    expect(() => applyOthelloMove(state, 0)).toThrow('非法落子');
    expect(() => applyOthelloMove(state, 19)).not.toThrow();

    const fullBoard = {
      ...state,
      board: Array(64).fill('black') as Array<'black' | 'white' | null>,
    };
    const next = passOthelloTurn(fullBoard);
    expect(next.status).toBe('won');
    expect(next.winner).toBe('black');
  });
});
