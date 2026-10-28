import { describe, expect, it } from 'vitest';

import {
  applyChessMove,
  createChessState,
  getChessLegalMoves,
  isChessInCheck,
  type ChessPiece,
  type ChessState,
} from './chess';

function stateWithBoard(board: Array<ChessPiece | null>, currentPlayer: ChessState['currentPlayer'] = 'white'): ChessState {
  return {
    ...createChessState(),
    board,
    currentPlayer,
  };
}

describe('chess rules', () => {
  it('creates the standard position and exposes white opening moves', () => {
    const state = createChessState();
    const moves = getChessLegalMoves(state);

    expect(state.board).toHaveLength(64);
    expect(state.board[0]).toEqual({ color: 'black', type: 'rook' });
    expect(state.board[60]).toEqual({ color: 'white', type: 'king' });
    expect(moves).toHaveLength(20);
  });

  it('applies a pawn move and records an en-passant target', () => {
    const next = applyChessMove(createChessState(), { from: 52, to: 36 });

    expect(next.board[36]).toEqual({ color: 'white', type: 'pawn' });
    expect(next.board[52]).toBeNull();
    expect(next.currentPlayer).toBe('black');
    expect(next.enPassantTarget).toBe(44);
  });

  it('supports castling only through safe squares', () => {
    const board = Array<ChessPiece | null>(64).fill(null);
    board[60] = { color: 'white', type: 'king' };
    board[63] = { color: 'white', type: 'rook' };
    board[4] = { color: 'black', type: 'king' };
    const state = stateWithBoard(board);
    const moves = getChessLegalMoves(state);
    const castle = moves.find(move => move.from === 60 && move.to === 62);

    expect(castle).toBeTruthy();
    const next = applyChessMove(state, castle!);
    expect(next.board[62]).toEqual({ color: 'white', type: 'king' });
    expect(next.board[61]).toEqual({ color: 'white', type: 'rook' });
  });

  it('filters moves that leave the king in check and detects checkmate', () => {
    const board = Array<ChessPiece | null>(64).fill(null);
    board[60] = { color: 'white', type: 'king' };
    board[4] = { color: 'black', type: 'king' };
    board[52] = { color: 'black', type: 'queen' };
    board[20] = { color: 'white', type: 'rook' };
    const state = stateWithBoard(board);

    expect(isChessInCheck(state, 'white')).toBe(true);
    expect(getChessLegalMoves(state).every(move => move.from === 60 || move.from === 20)).toBe(true);
    expect(getChessLegalMoves(state).some(move => move.from === 20 && move.to === 52)).toBe(true);
  });

  it('promotes a pawn to a selected piece', () => {
    const board = Array<ChessPiece | null>(64).fill(null);
    board[60] = { color: 'white', type: 'king' };
    board[4] = { color: 'black', type: 'king' };
    board[9] = { color: 'white', type: 'pawn' };
    const state = stateWithBoard(board);
    const next = applyChessMove(state, { from: 9, to: 1, promotion: 'knight' });

    expect(next.board[1]).toEqual({ color: 'white', type: 'knight' });
  });

  it('rejects occupied destinations and moves after game end', () => {
    const state = createChessState();
    expect(() => applyChessMove(state, { from: 60, to: 52 })).toThrow('非法走法');
    expect(() => applyChessMove({ ...state, status: 'checkmate', winner: 'black' }, { from: 52, to: 36 })).toThrow('对局已结束');
  });
});
