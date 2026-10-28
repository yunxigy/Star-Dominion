import {
  applyChessMove,
  getChessLegalMoves,
  isChessInCheck,
  type ChessColor,
  type ChessMove,
  type ChessPiece,
  type ChessState,
} from './chess';

export type ChessDifficulty = 'easy' | 'normal' | 'hard';

const PIECE_VALUES: Record<ChessPiece['type'], number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 20_000,
};

export function chooseChessMove(state: ChessState, difficulty: ChessDifficulty = 'normal'): ChessMove | null {
  const legalMoves = getChessLegalMoves(state);
  if (legalMoves.length === 0) return null;

  if (difficulty === 'easy') {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  const ai = state.currentPlayer;
  if (difficulty === 'normal') {
    return chooseTacticalMove(state, legalMoves) ?? legalMoves[0];
  }

  let bestScore = -Infinity;
  let bestMoves: ChessMove[] = [];
  for (const move of orderMoves(state, legalMoves)) {
    const next = applyChessMove(state, move);
    const score = minimax(next, ai, 2, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }
  return bestMoves[0] ?? legalMoves[0];
}

function chooseTacticalMove(state: ChessState, legalMoves: ChessMove[]): ChessMove | null {
  const ai = state.currentPlayer;
  const ordered = orderMoves(state, legalMoves);
  let bestScore = -Infinity;
  let bestMove: ChessMove | null = null;
  for (const move of ordered) {
    const next = applyChessMove(state, move);
    let score = captureValue(state, move) + (move.promotion ? PIECE_VALUES[move.promotion] : 0);
    if (next.status === 'checkmate' && next.winner === ai) score += 100_000;
    if (next.status === 'draw' || next.status === 'stalemate') score -= 100;
    if (isChessInCheck(next, next.currentPlayer)) score += 45;
    score += evaluatePosition(next, ai) / 100;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function minimax(state: ChessState, ai: ChessColor, depth: number, alpha: number, beta: number): number {
  if (state.status !== 'playing' || depth === 0) return evaluatePosition(state, ai);
  const moves = getChessLegalMoves(state);
  if (moves.length === 0) return evaluatePosition(state, ai);
  const maximizing = state.currentPlayer === ai;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of orderMoves(state, moves)) {
    const score = minimax(applyChessMove(state, move), ai, depth - 1, alpha, beta);
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

function evaluatePosition(state: ChessState, ai: ChessColor): number {
  if (state.status === 'checkmate') return state.winner === ai ? 100_000 : -100_000;
  if (state.status === 'draw' || state.status === 'stalemate') return 0;
  const material = state.board.reduce((score, piece) => {
    if (!piece) return score;
    const value = PIECE_VALUES[piece.type];
    return score + (piece.color === ai ? value : -value);
  }, 0);
  const mobility = getChessLegalMoves(state).length * (state.currentPlayer === ai ? 2 : -2);
  const checkBonus = isChessInCheck(state, state.currentPlayer)
    ? (state.currentPlayer === ai ? -35 : 35)
    : 0;
  return material + mobility + checkBonus;
}

function orderMoves(state: ChessState, moves: ChessMove[]): ChessMove[] {
  return [...moves].sort((left, right) => captureValue(state, right) - captureValue(state, left));
}

function captureValue(state: ChessState, move: ChessMove): number {
  const captured = state.board[move.to];
  if (captured) return PIECE_VALUES[captured.type];
  if (move.isEnPassant) return PIECE_VALUES.pawn;
  return 0;
}
