import { applyCheckersMove, getCheckersLegalMoves } from './checkers';
import type { CheckersMove, CheckersPiece, CheckersPlayer, CheckersState } from './checkers';

export type CheckersDifficulty = 'easy' | 'normal' | 'hard';

const MAN_VALUE = 100;
const KING_VALUE = 175;

export function chooseCheckersMove(state: CheckersState, difficulty: CheckersDifficulty = 'normal'): CheckersMove | null {
  const legalMoves = getCheckersLegalMoves(state);
  if (legalMoves.length === 0) return null;
  if (difficulty === 'easy') return legalMoves[Math.floor(Math.random() * legalMoves.length)];

  if (difficulty === 'normal') {
    return [...legalMoves].sort((left, right) => scoreMove(state, right) - scoreMove(state, left))[0];
  }

  const ai = state.currentPlayer;
  let bestScore = -Infinity;
  let bestMove = legalMoves[0];
  for (const move of orderMoves(state, legalMoves)) {
    const score = minimax(applyCheckersMove(state, move), ai, 3, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function scoreMove(state: CheckersState, move: CheckersMove): number {
  const movingPiece = state.board[move.path[0]];
  const finalRow = Math.floor(move.path[move.path.length - 1] / 8);
  const promotion = movingPiece && !movingPiece.king && ((movingPiece.player === 'black' && finalRow === 7) || (movingPiece.player === 'red' && finalRow === 0));
  return move.captures.length * 250 + (promotion ? 220 : 0) + move.path.length * 2;
}

function minimax(state: CheckersState, ai: CheckersPlayer, depth: number, alpha: number, beta: number): number {
  if (state.status !== 'playing' || depth === 0) return evaluatePosition(state, ai);
  const moves = getCheckersLegalMoves(state);
  if (moves.length === 0) return evaluatePosition(state, ai);
  const maximizing = state.currentPlayer === ai;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of orderMoves(state, moves)) {
    const score = minimax(applyCheckersMove(state, move), ai, depth - 1, alpha, beta);
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function evaluatePosition(state: CheckersState, ai: CheckersPlayer): number {
  if (state.status === 'won') return state.winner === ai ? 100_000 : -100_000;
  if (state.status === 'draw') return 0;
  return state.board.reduce((score, piece, index) => {
    if (!piece) return score;
    const material = piece.king ? KING_VALUE : MAN_VALUE;
    const row = Math.floor(index / 8);
    const advancement = piece.king ? 0 : (piece.player === 'black' ? row : 7 - row) * 4;
    const value = material + advancement;
    return score + (piece.player === ai ? value : -value);
  }, 0) + getCheckersLegalMoves(state).length * (state.currentPlayer === ai ? 2 : -2);
}

function orderMoves(state: CheckersState, moves: CheckersMove[]): CheckersMove[] {
  return [...moves].sort((left, right) => scoreMove(state, right) - scoreMove(state, left));
}
