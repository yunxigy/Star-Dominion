import {
  getTicTacToeLegalMoves,
  getTicTacToeResult,
  type TicTacToeCell,
  type TicTacToePlayer,
  type TicTacToeState,
} from './ticTacToe';

export type TicTacToeDifficulty = 'easy' | 'normal' | 'hard';

const CENTER = 4;
const CORNERS = [0, 2, 6, 8];

export function chooseTicTacToeMove(
  state: TicTacToeState,
  difficulty: TicTacToeDifficulty = 'normal',
): number | null {
  const legalMoves = getTicTacToeLegalMoves(state);
  if (legalMoves.length === 0) return null;

  if (difficulty === 'easy') {
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  if (difficulty === 'normal') {
    return chooseTacticalMove(state, legalMoves) ?? legalMoves[0];
  }

  const ai = state.currentPlayer;
  let bestScore = -Infinity;
  let bestMove = legalMoves[0];
  for (const move of legalMoves) {
    const board = [...state.board];
    board[move] = ai;
    const score = minimax(board, otherPlayer(ai), ai, 0);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function chooseTacticalMove(state: TicTacToeState, legalMoves: number[]): number | null {
  const player = state.currentPlayer;
  const opponent = otherPlayer(player);
  const winningMove = findImmediateMove(state.board, legalMoves, player);
  if (winningMove !== null) return winningMove;

  const blockingMove = findImmediateMove(state.board, legalMoves, opponent);
  if (blockingMove !== null) return blockingMove;

  if (state.board[CENTER] === null) return CENTER;
  const openCorner = CORNERS.find(index => state.board[index] === null);
  return openCorner ?? null;
}

function findImmediateMove(
  board: TicTacToeCell[],
  legalMoves: number[],
  player: TicTacToePlayer,
): number | null {
  for (const move of legalMoves) {
    const nextBoard = [...board];
    nextBoard[move] = player;
    const result = getTicTacToeResult(nextBoard);
    if (result.winner === player) return move;
  }
  return null;
}

function minimax(
  board: TicTacToeCell[],
  currentPlayer: TicTacToePlayer,
  aiPlayer: TicTacToePlayer,
  depth: number,
): number {
  const result = getTicTacToeResult(board);
  if (result.status === 'won') {
    return result.winner === aiPlayer ? 10 - depth : depth - 10;
  }
  if (result.status === 'draw') return 0;

  const legalMoves = board.reduce<number[]>((moves, cell, index) => {
    if (cell === null) moves.push(index);
    return moves;
  }, []);
  const maximizing = currentPlayer === aiPlayer;
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const move of legalMoves) {
    const nextBoard = [...board];
    nextBoard[move] = currentPlayer;
    const score = minimax(nextBoard, otherPlayer(currentPlayer), aiPlayer, depth + 1);
    bestScore = maximizing ? Math.max(bestScore, score) : Math.min(bestScore, score);
  }

  return bestScore;
}

function otherPlayer(player: TicTacToePlayer): TicTacToePlayer {
  return player === 'X' ? 'O' : 'X';
}
