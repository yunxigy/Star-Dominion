import {
  applyOthelloMove,
  getOthelloLegalMoves,
  getOthelloResult,
  passOthelloTurn,
  OTHELLO_SIZE,
  type OthelloCell,
  type OthelloPlayer,
  type OthelloState,
} from './othello';

export type OthelloDifficulty = 'easy' | 'normal' | 'hard';

const SEARCH_DEPTH = 3;
const POSITION_WEIGHTS = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

export function chooseOthelloMove(state: OthelloState, difficulty: OthelloDifficulty = 'normal'): number | null {
  const legalMoves = getOthelloLegalMoves(state);
  if (legalMoves.length === 0) return null;
  if (difficulty === 'easy') return legalMoves[Math.floor(Math.random() * legalMoves.length)];

  const orderedMoves = orderMoves(legalMoves);
  if (difficulty === 'normal') {
    return orderedMoves.reduce((bestMove, move) => {
      const score = scoreMove(state, move);
      return score > scoreMove(state, bestMove) ? move : bestMove;
    }, orderedMoves[0]);
  }

  const aiPlayer = state.currentPlayer;
  let bestScore = -Infinity;
  let bestMove = orderedMoves[0];
  for (const move of orderedMoves) {
    let next: OthelloState;
    try {
      next = applyOthelloMove(state, move);
    } catch {
      continue;
    }
    const score = minimax(next, otherPlayer(aiPlayer), aiPlayer, SEARCH_DEPTH - 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function minimax(
  state: OthelloState,
  currentPlayer: OthelloPlayer,
  aiPlayer: OthelloPlayer,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const result = getOthelloResult(state.board);
  if (result.status !== 'playing') return terminalScore(result.winner, aiPlayer);
  if (depth === 0) return evaluateBoard(state.board, aiPlayer);

  const activeState = state.currentPlayer === currentPlayer ? state : { ...state, currentPlayer };
  let legalMoves = getOthelloLegalMoves(activeState);
  if (legalMoves.length === 0) {
    const passed = passOthelloTurn(activeState);
    if (passed.status !== 'playing') return terminalScore(passed.winner, aiPlayer);
    return minimax(passed, passed.currentPlayer, aiPlayer, depth - 1, alpha, beta);
  }

  legalMoves = orderMoves(legalMoves);
  const maximizing = currentPlayer === aiPlayer;
  let bestScore = maximizing ? -Infinity : Infinity;
  for (const move of legalMoves) {
    let next: OthelloState;
    try {
      next = applyOthelloMove(activeState, move);
    } catch {
      continue;
    }
    const score = minimax(next, next.currentPlayer, aiPlayer, depth - 1, alpha, beta);
    if (maximizing) {
      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, bestScore);
    } else {
      bestScore = Math.min(bestScore, score);
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha) break;
  }
  return bestScore;
}

function scoreMove(state: OthelloState, move: number): number {
  const board = [...state.board];
  const flips = countFlips(state, move);
  const cornerBonus = isCorner(move) ? 1_000 : 0;
  board[move] = state.currentPlayer;
  return cornerBonus + POSITION_WEIGHTS[move] + flips * 8 - getOpponentCornerPotential(board, state.currentPlayer);
}

function evaluateBoard(board: OthelloCell[], aiPlayer: OthelloPlayer): number {
  const opponent = otherPlayer(aiPlayer);
  let score = 0;
  let aiDiscs = 0;
  let opponentDiscs = 0;
  for (let index = 0; index < board.length; index += 1) {
    const cell = board[index];
    if (cell === aiPlayer) {
      aiDiscs += 1;
      score += POSITION_WEIGHTS[index];
    } else if (cell === opponent) {
      opponentDiscs += 1;
      score -= POSITION_WEIGHTS[index];
    }
  }

  const aiMobility = getLegalMovesForBoard(board, aiPlayer).length;
  const opponentMobility = getLegalMovesForBoard(board, opponent).length;
  const cornerDifference = getCorners(board, aiPlayer).length - getCorners(board, opponent).length;
  score += (aiDiscs - opponentDiscs) * 2;
  score += (aiMobility - opponentMobility) * 7;
  score += cornerDifference * 35;
  return score;
}

function countFlips(state: OthelloState, move: number): number {
  try {
    const next = applyOthelloMove(state, move);
    const before = state.board.filter(cell => cell === state.currentPlayer).length;
    const after = next.board.filter(cell => cell === state.currentPlayer).length;
    return Math.max(0, after - before - 1);
  } catch {
    return 0;
  }
}

function getOpponentCornerPotential(board: OthelloCell[], player: OthelloPlayer): number {
  const opponent = otherPlayer(player);
  return getLegalMovesForBoard(board, opponent).filter(isCorner).length * 14;
}

function getLegalMovesForBoard(board: OthelloCell[], player: OthelloPlayer): number[] {
  const state: OthelloState = {
    board,
    currentPlayer: player,
    status: 'playing',
    winner: null,
    lastMove: null,
    lastPass: null,
  };
  return getOthelloLegalMoves(state);
}

function orderMoves(moves: number[]): number[] {
  return [...moves].sort((a, b) => {
    const cornerDifference = Number(isCorner(b)) - Number(isCorner(a));
    return cornerDifference || POSITION_WEIGHTS[b] - POSITION_WEIGHTS[a];
  });
}

function getCorners(board: OthelloCell[], player: OthelloPlayer): number[] {
  return [0, OTHELLO_SIZE - 1, OTHELLO_SIZE * (OTHELLO_SIZE - 1), board.length - 1]
    .filter(index => board[index] === player);
}

function isCorner(index: number): boolean {
  return index === 0 || index === OTHELLO_SIZE - 1 || index === OTHELLO_SIZE * (OTHELLO_SIZE - 1) || index === OTHELLO_SIZE * OTHELLO_SIZE - 1;
}

function terminalScore(winner: OthelloPlayer | null, aiPlayer: OthelloPlayer): number {
  if (!winner) return 0;
  return winner === aiPlayer ? 100_000 : -100_000;
}

function otherPlayer(player: OthelloPlayer): OthelloPlayer {
  return player === 'black' ? 'white' : 'black';
}
