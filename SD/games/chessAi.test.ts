import { describe, expect, it } from 'vitest';

import { createChessState, type ChessPiece, type ChessState } from './chess';
import { chooseChessMove, type ChessDifficulty } from './chessAi';

function stateWithBoard(board: Array<ChessPiece | null>, currentPlayer: ChessState['currentPlayer'] = 'white'): ChessState {
  return { ...createChessState(), board, currentPlayer };
}

describe('chess AI', () => {
  it.each<ChessDifficulty>(['easy', 'normal', 'hard'])('returns a legal move on %s difficulty', difficulty => {
    const move = chooseChessMove(createChessState(), difficulty);

    expect(move).toBeTruthy();
    expect(move?.from).toBeGreaterThanOrEqual(0);
    expect(move?.to).toBeLessThan(64);
  });

  it('finds a free queen capture on tactical difficulty', () => {
    const board = Array<ChessPiece | null>(64).fill(null);
    board[60] = { color: 'white', type: 'king' };
    board[4] = { color: 'black', type: 'king' };
    board[56] = { color: 'white', type: 'rook' };
    board[8] = { color: 'black', type: 'queen' };
    const move = chooseChessMove(stateWithBoard(board), 'normal');

    expect(move).toMatchObject({ from: 56, to: 8 });
  });

  it('returns null for a terminal position', () => {
    const state = { ...createChessState(), status: 'checkmate' as const, winner: 'black' as const };
    expect(chooseChessMove(state, 'hard')).toBeNull();
  });
});
