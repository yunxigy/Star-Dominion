import {
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  getConnectFourLegalColumns,
  getConnectFourResult,
  type ConnectFourCell,
  type ConnectFourPlayer,
  type ConnectFourState,
} from './connectFour';

export type ConnectFourDifficulty = 'easy' | 'normal' | 'hard';

const SEARCH_DEPTH = 4;
const CENTER_FIRST_COLUMNS = [3, 2, 4, 1, 5, 0, 6];

export function chooseConnectFourMove(
  state: ConnectFourState,
  difficulty: ConnectFourDifficulty = 'normal',
): number | null {
  const legalColumns = getConnectFourLegalColumns(state);
  if (legalColumns.length === 0) return null;

  if (difficulty === 'easy') {
    return legalColumns[Math.floor(Math.random() * legalColumns.length)];
  }

  const tacticalMove = findTacticalMove(state, legalColumns);
  if (tacticalMove !== null) return tacticalMove;
  if (difficulty === 'normal') return preferredColumn(legalColumns);

  const aiPlayer = state.currentPlayer;
  let bestScore = -Infinity;
  let bestMove = preferredColumn(legalColumns);
  for (const column of orderColumns(legalColumns)) {
    const drop = dropPiece(state.board, column, aiPlayer);
    if (!drop) continue;
    const score = minimax(drop.board, otherPlayer(aiPlayer), aiPlayer, SEARCH_DEPTH - 1, -Infinity, Infinity);
    if (score > bestScore) {
      bestScore = score;
      bestMove = column;
    }
  }
  return bestMove;
}

function findTacticalMove(state: ConnectFourState, legalColumns: number[]): number | null {
  const player = state.currentPlayer;
  const opponent = otherPlayer(player);

  for (const column of orderColumns(legalColumns)) {
    const drop = dropPiece(state.board, column, player);
    if (drop && getConnectFourResult(drop.board, drop.index).winner === player) return column;
  }

  for (const column of orderColumns(legalColumns)) {
    const drop = dropPiece(state.board, column, opponent);
    if (drop && getConnectFourResult(drop.board, drop.index).winner === opponent) return column;
  }

  return null;
}

function minimax(
  board: ConnectFourCell[],
  currentPlayer: ConnectFourPlayer,
  aiPlayer: ConnectFourPlayer,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const result = getConnectFourResult(board);
  if (result.status === 'won') return result.winner === aiPlayer ? 100000 + depth : -100000 - depth;
  if (result.status === 'draw') return 0;
  if (depth === 0) return evaluateBoard(board, aiPlayer);

  const legalColumns = getLegalColumnsForBoard(board);
  const maximizing = currentPlayer === aiPlayer;
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const column of orderColumns(legalColumns)) {
    const drop = dropPiece(board, column, currentPlayer);
    if (!drop) continue;
    const score = minimax(drop.board, otherPlayer(currentPlayer), aiPlayer, depth - 1, alpha, beta);
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

function evaluateBoard(board: ConnectFourCell[], aiPlayer: ConnectFourPlayer): number {
  const opponent = otherPlayer(aiPlayer);
  let score = 0;
  const centerColumn = Math.floor(CONNECT_FOUR_COLUMNS / 2);
  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    if (board[row * CONNECT_FOUR_COLUMNS + centerColumn] === aiPlayer) score += 4;
  }

  for (let row = 0; row < CONNECT_FOUR_ROWS; row += 1) {
    for (let column = 0; column < CONNECT_FOUR_COLUMNS; column += 1) {
      for (const [rowStep, columnStep] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
        const endRow = row + rowStep * 3;
        const endColumn = column + columnStep * 3;
        if (endRow < 0 || endRow >= CONNECT_FOUR_ROWS || endColumn < 0 || endColumn >= CONNECT_FOUR_COLUMNS) continue;
        const window = [0, 1, 2, 3].map(offset => board[(row + rowStep * offset) * CONNECT_FOUR_COLUMNS + column + columnStep * offset]);
        score += scoreWindow(window, aiPlayer, opponent);
      }
    }
  }
  return score;
}

function scoreWindow(window: ConnectFourCell[], aiPlayer: ConnectFourPlayer, opponent: ConnectFourPlayer): number {
  const aiCount = window.filter(cell => cell === aiPlayer).length;
  const opponentCount = window.filter(cell => cell === opponent).length;
  const emptyCount = window.filter(cell => cell === null).length;
  if (aiCount === 4) return 100;
  if (aiCount === 3 && emptyCount === 1) return 12;
  if (aiCount === 2 && emptyCount === 2) return 3;
  if (opponentCount === 4) return -100;
  if (opponentCount === 3 && emptyCount === 1) return -15;
  if (opponentCount === 2 && emptyCount === 2) return -4;
  return 0;
}

function dropPiece(board: ConnectFourCell[], column: number, player: ConnectFourPlayer): { board: ConnectFourCell[]; index: number } | null {
  for (let row = CONNECT_FOUR_ROWS - 1; row >= 0; row -= 1) {
    const index = row * CONNECT_FOUR_COLUMNS + column;
    if (board[index] === null) {
      const nextBoard = [...board];
      nextBoard[index] = player;
      return { board: nextBoard, index };
    }
  }
  return null;
}

function getLegalColumnsForBoard(board: ConnectFourCell[]): number[] {
  return Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => column)
    .filter(column => board[column] === null);
}

function orderColumns(columns: number[]): number[] {
  return CENTER_FIRST_COLUMNS.filter(column => columns.includes(column));
}

function preferredColumn(columns: number[]): number {
  return orderColumns(columns)[0] ?? columns[0];
}

function otherPlayer(player: ConnectFourPlayer): ConnectFourPlayer {
  return player === 'red' ? 'yellow' : 'red';
}
