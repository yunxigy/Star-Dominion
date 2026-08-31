import { describe, expect, it } from 'vitest';

import { createCheckersState, type CheckersPiece, type CheckersState } from './checkers';
import { chooseCheckersMove, type CheckersDifficulty } from './checkersAi';

function stateWithBoard(board: Array<CheckersPiece | null>, currentPlayer: CheckersState['currentPlayer'] = 'black'): CheckersState {
  return { ...createCheckersState(), board, currentPlayer };
}

describe('checkers AI', () => {
  it.each<CheckersDifficulty>(['easy', 'normal', 'hard'])('returns a legal move on %s difficulty', difficulty => {
    const move = chooseCheckersMove(createCheckersState(), difficulty);

    expect(move).toBeTruthy();
    expect(move?.path.length).toBeGreaterThanOrEqual(2);
  });

  it('chooses the only mandatory capture', () => {
    const board = Array<CheckersPiece | null>(64).fill(null);
    board[17] = { player: 'black', king: false };
    board[26] = { player: 'red', king: false };
    const move = chooseCheckersMove(stateWithBoard(board), 'normal');

    expect(move).toMatchObject({ path: [17, 35], captures: [26] });
  });

  it('returns null for a terminal position', () => {
    const state = { ...createCheckersState(), status: 'won' as const, winner: 'red' as const };
    expect(chooseCheckersMove(state, 'hard')).toBeNull();
  });
});
