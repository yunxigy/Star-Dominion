import { describe, expect, it } from 'vitest';

import {
  applyXiangqiMove,
  createXiangqiState,
  getXiangqiLegalMoves,
  isXiangqiInCheck,
  type XiangqiPiece,
  type XiangqiState,
} from './xiangqi';

function stateWithBoard(board: Array<XiangqiPiece | null>, currentPlayer: XiangqiState['currentPlayer'] = 'red'): XiangqiState {
  return { ...createXiangqiState(), board, currentPlayer };
}

describe('xiangqi rules', () => {
  it('creates the standard position and red has opening moves', () => {
    const state = createXiangqiState();

    expect(state.board).toHaveLength(90);
    expect(state.board[4]).toEqual({ color: 'black', type: 'general' });
    expect(state.board[85]).toEqual({ color: 'red', type: 'general' });
    expect(getXiangqiLegalMoves(state).length).toBeGreaterThan(0);
  });

  it('moves a red soldier forward but not backward', () => {
    const board = Array<XiangqiPiece | null>(90).fill(null);
    board[85] = { color: 'red', type: 'general' };
    board[4] = { color: 'black', type: 'general' };
    board[49] = { color: 'red', type: 'soldier' };
    board[63] = { color: 'red', type: 'soldier' };
    const state = stateWithBoard(board);
    const moves = getXiangqiLegalMoves(state, 63);

    expect(moves).toContainEqual({ from: 63, to: 54 });
    expect(moves).not.toContainEqual({ from: 63, to: 72 });
  });

  it('blocks a horse leg and allows a cannon capture across one screen', () => {
    const board = Array<XiangqiPiece | null>(90).fill(null);
    board[85] = { color: 'red', type: 'general' };
    board[4] = { color: 'black', type: 'general' };
    board[76] = { color: 'red', type: 'horse' };
    board[67] = { color: 'red', type: 'soldier' };
    board[70] = { color: 'red', type: 'cannon' };
    board[61] = { color: 'red', type: 'soldier' };
    board[52] = { color: 'black', type: 'chariot' };

    expect(getXiangqiLegalMoves(stateWithBoard(board), 76)).not.toContainEqual({ from: 76, to: 58 });
    expect(getXiangqiLegalMoves(stateWithBoard(board), 70)).toContainEqual({ from: 70, to: 52 });
  });

  it('prevents generals from facing each other and identifies check', () => {
    const board = Array<XiangqiPiece | null>(90).fill(null);
    board[4] = { color: 'black', type: 'general' };
    board[85] = { color: 'red', type: 'general' };
    board[13] = { color: 'black', type: 'chariot' };
    const state = stateWithBoard(board);

    expect(isXiangqiInCheck(state, 'red')).toBe(true);
    expect(getXiangqiLegalMoves(state, 85)).not.toContainEqual({ from: 85, to: 76 });
  });

  it('applies a move and switches sides', () => {
    const next = applyXiangqiMove(createXiangqiState(), { from: 82, to: 63 });

    expect(next.board[63]).toEqual({ color: 'red', type: 'horse' });
    expect(next.board[82]).toBeNull();
    expect(next.currentPlayer).toBe('black');
  });
});
