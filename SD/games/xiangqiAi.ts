import {
  applyXiangqiMove,
  getXiangqiLegalMoves,
  isXiangqiInCheck,
  type XiangqiColor,
  type XiangqiMove,
  type XiangqiPiece,
  type XiangqiState,
} from './xiangqi';

export type XiangqiDifficulty = 'easy' | 'normal' | 'hard';

const PIECE_VALUES: Record<XiangqiPiece['type'], number> = {
  soldier: 100,
  advisor: 200,
  elephant: 220,
  horse: 400,
  cannon: 450,
  chariot: 900,
  general: 10_000,
};

export function chooseXiangqiMove(state: XiangqiState, difficulty: XiangqiDifficulty = 'normal'): XiangqiMove | null {
  const legalMoves = getXiangqiLegalMoves(state);
  if (legalMoves.length === 0) return null;
  if (difficulty === 'easy') return legalMoves[Math.floor(Math.random() * legalMoves.length)];

  const ai = state.currentPlayer;
  if (difficulty === 'normal') return chooseTacticalMove(state, legalMoves) ?? legalMoves[0];

  let bestScore = -Infinity;
  let bestMove = legalMoves[0];
  for (const move of orderMoves(state, legalMoves)) {
    const score = minimax(applyXiangqiMove(state, move), ai, 2, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function chooseTacticalMove(state: XiangqiState, moves: XiangqiMove[]): XiangqiMove | null {
  const ai = state.currentPlayer;
  let bestScore = -Infinity;
  let bestMove: XiangqiMove | null = null;
  for (const move of orderMoves(state, moves)) {
    const target = state.board[move.to];
    const next = applyXiangqiMove(state, move);
    let score = target ? PIECE_VALUES[target.type] : 0;
    if (next.status === 'won' || next.status === 'checkmate') score += 100_000;
    if (isXiangqiInCheck(next, next.currentPlayer)) score += 35;
    score += evaluatePosition(next, ai) / 100;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function minimax(state: XiangqiState, ai: XiangqiColor, depth: number, alpha: number, beta: number): number {
  if (state.status !== 'playing' || depth === 0) return evaluatePosition(state, ai);
  const moves = getXiangqiLegalMoves(state);
  if (moves.length === 0) return evaluatePosition(state, ai);
  const maximizing = state.currentPlayer === ai;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of orderMoves(state, moves)) {
    const score = minimax(applyXiangqiMove(state, move), ai, depth - 1, alpha, beta);
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

function evaluatePosition(state: XiangqiState, ai: XiangqiColor): number {
  if (state.status === 'won' || state.status === 'checkmate' || state.status === 'stalemate') {
    return state.winner === ai ? 100_000 : -100_000;
  }
  const material = state.board.reduce((score, piece) => {
    if (!piece) return score;
    const value = PIECE_VALUES[piece.type];
    return score + (piece.color === ai ? value : -value);
  }, 0);
  const mobility = getXiangqiLegalMoves(state).length * (state.currentPlayer === ai ? 2 : -2);
  const checkBonus = isXiangqiInCheck(state, state.currentPlayer)
    ? (state.currentPlayer === ai ? -40 : 40)
    : 0;
  return material + mobility + checkBonus;
}

function orderMoves(state: XiangqiState, moves: XiangqiMove[]): XiangqiMove[] {
  return [...moves].sort((left, right) => captureValue(state, right) - captureValue(state, left));
}

function captureValue(state: XiangqiState, move: XiangqiMove): number {
  return state.board[move.to] ? PIECE_VALUES[state.board[move.to]!.type] : 0;
}
