import { describe, expect, it } from 'vitest';

import {
  applyCheckersMove,
  createCheckersState,
  getCheckersLegalMoves,
  type CheckersPiece,
  type CheckersState,
} from './checkers';

function stateWithBoard(board: Array<CheckersPiece | null>, currentPlayer: CheckersState['currentPlayer'] = 'black'): CheckersState {
  return { ...createCheckersState(), board, currentPlayer };
}

describe('checkers rules', () => {
  it('creates a standard board with 24 pieces and legal opening moves', () => {
    const state = createCheckersState();

    expect(state.board.filter(Boolean)).toHaveLength(24);
    expect(getCheckersLegalMoves(state).length).toBeGreaterThan(0);
  });

  it('requires captures when one is available', () => {
    const board = Array<CheckersPiece | null>(64).fill(null);
    board[17] = { player: 'black', king: false };
    board[26] = { player: 'red', king: false };
    board[21] = { player: 'black', king: false };
    board[48] = { player: 'red', king: false };
    const moves = getCheckersLegalMoves(stateWithBoard(board));

    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ path: [17, 35], captures: [26] });
  });

  it('allows a man to capture backwards while quiet moves stay forward', () => {
    const board = Array<CheckersPiece | null>(64).fill(null);
    board[35] = { player: 'black', king: false };
    board[26] = { player: 'red', king: false };

    expect(getCheckersLegalMoves(stateWithBoard(board))).toContainEqual({ path: [35, 17], captures: [26] });
  });

  it('supports a multi-jump and promotes a man at the far edge', () => {
    const board = Array<CheckersPiece | null>(64).fill(null);
    board[9] = { player: 'black', king: false };
    board[18] = { player: 'red', king: false };
    board[36] = { player: 'red', king: false };
    board[54] = { player: 'red', king: false };
    const state = stateWithBoard(board);
    const move = getCheckersLegalMoves(state)[0];

    expect(move.path).toEqual([9, 27, 45, 63]);
    const next = applyCheckersMove(state, move);
    expect(next.board[63]).toEqual({ player: 'black', king: true });
    expect(next.board[18]).toBeNull();
    expect(next.board[36]).toBeNull();
    expect(next.board[54]).toBeNull();
  });

  it('ends the game when the opponent has no legal move', () => {
    const board = Array<CheckersPiece | null>(64).fill(null);
    board[17] = { player: 'black', king: false };
    board[26] = { player: 'red', king: false };
    const state = stateWithBoard(board);
    const next = applyCheckersMove(state, { path: [17, 35], captures: [26] });

    expect(next.status).toBe('won');
    expect(next.winner).toBe('black');
  });

  it('rejects a quiet move when a capture is mandatory', () => {
    const board = Array<CheckersPiece | null>(64).fill(null);
    board[17] = { player: 'black', king: false };
    board[26] = { player: 'red', king: false };
    board[21] = { player: 'black', king: false };
    const state = stateWithBoard(board);

    expect(() => applyCheckersMove(state, { path: [21, 30], captures: [] })).toThrow('非法走法');
  });
});
