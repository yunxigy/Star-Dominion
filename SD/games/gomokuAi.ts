import {
  GOMOKU_SIZE,
  getGomokuLegalMoves,
  getGomokuResult,
  type GomokuCell,
  type GomokuPlayer,
  type GomokuState,
} from './gomoku';

export type GomokuDifficulty = 'easy' | 'normal' | 'hard';

const SEARCH_DEPTH = 2;
const CENTER_INDEX = Math.floor(GOMOKU_SIZE / 2);
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export function chooseGomokuMove(state: GomokuState, difficulty: GomokuDifficulty = 'normal'): number | null {
  const legalMoves = getGomokuLegalMoves(state);
  if (legalMoves.length === 0) return null;

  if (difficulty === 'easy') {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  if (legalMoves.length === GOMOKU_SIZE * GOMOKU_SIZE) return CENTER_INDEX * GOMOKU_SIZE + CENTER_INDEX;

  const tacticalMove = findTacticalMove(state, legalMoves);
  if (tacticalMove !== null) return tacticalMove;

  const candidates = getCandidateMoves(state.board, legalMoves);
  if (difficulty === 'normal') return chooseHeuristicMove(state.board, state.currentPlayer, candidates);

  const aiPlayer = state.currentPlayer;
  let bestScore = -Infinity;
  let bestMove = candidates[0] ?? legalMoves[0];
  for (const move of candidates) {
    const board = placeStone(state.board, move, aiPlayer);
    const score = minimax(board, otherPlayer(aiPlayer), aiPlayer, SEARCH_DEPTH - 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function findTacticalMove(state: GomokuState, legalMoves: number[]): number | null {
  const player = state.currentPlayer;
  const opponent = otherPlayer(player);
  const orderedMoves = [...legalMoves].sort((a, b) => centerDistance(a) - centerDistance(b));

  for (const move of orderedMoves) {
    const board = placeStone(state.board, move, player);
    if (getGomokuResult(board, move).winner === player) return move;
  }

  for (const move of orderedMoves) {
    const board = placeStone(state.board, move, opponent);
    if (getGomokuResult(board, move).winner === opponent) return move;
  }

  return null;
}

function chooseHeuristicMove(board: GomokuCell[], player: GomokuPlayer, candidates: number[]): number {
  const opponent = otherPlayer(player);
  let bestScore = -Infinity;
  let bestMove = candidates[0];

  for (const move of candidates) {
    const ownBoard = placeStone(board, move, player);
    const opponentBoard = placeStone(board, move, opponent);
    const score = scorePlacement(ownBoard, move, player) + scorePlacement(opponentBoard, move, opponent) * 0.86;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

function minimax(
  board: GomokuCell[],
  currentPlayer: GomokuPlayer,
  aiPlayer: GomokuPlayer,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const result = getGomokuResult(board);
  if (result.status === 'won') return result.winner === aiPlayer ? 1_000_000 + depth : -1_000_000 - depth;
  if (result.status === 'draw') return 0;
  if (depth === 0) return evaluateBoard(board, aiPlayer);

  const legalMoves = getCandidateMoves(board, getAllLegalMoves(board));
  const maximizing = currentPlayer === aiPlayer;
  let bestScore = maximizing ? -Infinity : Infinity;
  for (const move of legalMoves) {
    const score = minimax(
      placeStone(board, move, currentPlayer),
      otherPlayer(currentPlayer),
      aiPlayer,
      depth - 1,
      alpha,
      beta,
    );
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

function evaluateBoard(board: GomokuCell[], player: GomokuPlayer): number {
  const opponent = otherPlayer(player);
  const candidates = getCandidateMoves(board, getAllLegalMoves(board));
  let score = 0;
  for (const move of candidates) {
    score += scorePlacement(placeStone(board, move, player), move, player);
    score -= scorePlacement(placeStone(board, move, opponent), move, opponent) * 0.9;
  }
  return score;
}

function getCandidateMoves(board: GomokuCell[], legalMoves: number[]): number[] {
  if (legalMoves.length <= 1) return legalMoves;
  const occupied = board.reduce<number[]>((indices, cell, index) => {
    if (cell !== null) indices.push(index);
    return indices;
  }, []);
  if (occupied.length === 0) return [CENTER_INDEX * GOMOKU_SIZE + CENTER_INDEX];

  const nearby = legalMoves.filter(move => {
    const row = Math.floor(move / GOMOKU_SIZE);
    const column = move % GOMOKU_SIZE;
    return occupied.some(index => {
      const occupiedRow = Math.floor(index / GOMOKU_SIZE);
      const occupiedColumn = index % GOMOKU_SIZE;
      return Math.max(Math.abs(row - occupiedRow), Math.abs(column - occupiedColumn)) <= 2;
    });
  });
  const source = nearby.length > 0 ? nearby : legalMoves;
  return [...source].sort((a, b) => centerDistance(a) - centerDistance(b)).slice(0, 28);
}

function scorePlacement(board: GomokuCell[], index: number, player: GomokuPlayer): number {
  const row = Math.floor(index / GOMOKU_SIZE);
  const column = index % GOMOKU_SIZE;
  let score = 0;
  for (const [rowStep, columnStep] of DIRECTIONS) {
    const forward = countDirection(board, row, column, rowStep, columnStep, player, 1);
    const backward = countDirection(board, row, column, rowStep, columnStep, player, -1);
    const length = forward + backward + 1;
    const openEnds = Number(isOpen(board, row, column, rowStep, columnStep, player, 1))
      + Number(isOpen(board, row, column, rowStep, columnStep, player, -1));
    score += patternScore(length, openEnds);
  }
  return score + Math.max(0, 8 - centerDistance(index));
}

function patternScore(length: number, openEnds: number): number {
  if (length >= 5) return 1_000_000;
  if (length === 4) return openEnds === 2 ? 80_000 : 12_000;
  if (length === 3) return openEnds === 2 ? 4_000 : 500;
  if (length === 2) return openEnds === 2 ? 180 : 35;
  return openEnds > 0 ? 8 : 0;
}

function countDirection(
  board: GomokuCell[],
  row: number,
  column: number,
  rowStep: number,
  columnStep: number,
  player: GomokuPlayer,
  direction: number,
): number {
  let count = 0;
  let nextRow = row + rowStep * direction;
  let nextColumn = column + columnStep * direction;
  while (
    nextRow >= 0
    && nextRow < GOMOKU_SIZE
    && nextColumn >= 0
    && nextColumn < GOMOKU_SIZE
    && board[nextRow * GOMOKU_SIZE + nextColumn] === player
  ) {
    count += 1;
    nextRow += rowStep * direction;
    nextColumn += columnStep * direction;
  }
  return count;
}

function isOpen(
  board: GomokuCell[],
  row: number,
  column: number,
  rowStep: number,
  columnStep: number,
  player: GomokuPlayer,
  direction: number,
): boolean {
  let nextRow = row + rowStep * direction;
  let nextColumn = column + columnStep * direction;
  while (
    nextRow >= 0
    && nextRow < GOMOKU_SIZE
    && nextColumn >= 0
    && nextColumn < GOMOKU_SIZE
    && board[nextRow * GOMOKU_SIZE + nextColumn] === player
  ) {
    nextRow += rowStep * direction;
    nextColumn += columnStep * direction;
  }
  return nextRow >= 0
    && nextRow < GOMOKU_SIZE
    && nextColumn >= 0
    && nextColumn < GOMOKU_SIZE
    && board[nextRow * GOMOKU_SIZE + nextColumn] === null;
}

function getAllLegalMoves(board: GomokuCell[]): number[] {
  return board.reduce<number[]>((moves, cell, index) => {
    if (cell === null) moves.push(index);
    return moves;
  }, []);
}

function placeStone(board: GomokuCell[], index: number, player: GomokuPlayer): GomokuCell[] {
  const nextBoard = [...board];
  nextBoard[index] = player;
  return nextBoard;
}

function centerDistance(index: number): number {
  const row = Math.floor(index / GOMOKU_SIZE);
  const column = index % GOMOKU_SIZE;
  return Math.abs(row - CENTER_INDEX) + Math.abs(column - CENTER_INDEX);
}

function otherPlayer(player: GomokuPlayer): GomokuPlayer {
  return player === 'black' ? 'white' : 'black';
}
