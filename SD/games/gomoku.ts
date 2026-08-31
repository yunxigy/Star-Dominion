export const GOMOKU_SIZE = 15;

export type GomokuPlayer = 'black' | 'white';
export type GomokuCell = GomokuPlayer | null;
export type GomokuStatus = 'playing' | 'won' | 'draw';

export interface GomokuState {
  board: GomokuCell[];
  currentPlayer: GomokuPlayer;
  status: GomokuStatus;
  winner: GomokuPlayer | null;
  winningLine: number[];
}

export interface GomokuResult {
  status: GomokuStatus;
  winner: GomokuPlayer | null;
  winningLine: number[];
}

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export function createGomokuState(): GomokuState {
  return {
    board: Array(GOMOKU_SIZE * GOMOKU_SIZE).fill(null),
    currentPlayer: 'black',
    status: 'playing',
    winner: null,
    winningLine: [],
  };
}

export function getGomokuLegalMoves(state: GomokuState): number[] {
  if (state.status !== 'playing') return [];
  return state.board.reduce<number[]>((moves, cell, index) => {
    if (cell === null) moves.push(index);
    return moves;
  }, []);
}

export function getGomokuResult(board: GomokuCell[], lastMove?: number): GomokuResult {
  const candidateIndices = lastMove === undefined
    ? board.reduce<number[]>((indices, cell, index) => {
      if (cell !== null) indices.push(index);
      return indices;
    }, [])
    : [lastMove];

  for (const index of candidateIndices) {
    const player = board[index];
    if (!player) continue;
    const winningLine = findWinningLine(board, index, player);
    if (winningLine.length >= 5) {
      return { status: 'won', winner: player, winningLine };
    }
  }

  return board.every(Boolean)
    ? { status: 'draw', winner: null, winningLine: [] }
    : { status: 'playing', winner: null, winningLine: [] };
}

export function applyGomokuMove(state: GomokuState, index: number): GomokuState {
  if (state.status !== 'playing') {
    throw new Error('对局已结束');
  }
  if (!Number.isInteger(index) || index < 0 || index >= GOMOKU_SIZE * GOMOKU_SIZE || state.board[index] !== null) {
    throw new Error('非法落子');
  }

  const board = [...state.board];
  board[index] = state.currentPlayer;
  const result = getGomokuResult(board, index);

  return {
    board,
    currentPlayer: result.status === 'playing' ? otherPlayer(state.currentPlayer) : state.currentPlayer,
    ...result,
  };
}

function findWinningLine(board: GomokuCell[], index: number, player: GomokuPlayer): number[] {
  const row = Math.floor(index / GOMOKU_SIZE);
  const column = index % GOMOKU_SIZE;

  for (const [rowStep, columnStep] of DIRECTIONS) {
    const line = [index];
    collectDirection(board, row, column, rowStep, columnStep, player, line, false);
    collectDirection(board, row, column, rowStep, columnStep, player, line, true);
    if (line.length >= 5) return line.sort((a, b) => a - b);
  }

  return [];
}

function collectDirection(
  board: GomokuCell[],
  row: number,
  column: number,
  rowStep: number,
  columnStep: number,
  player: GomokuPlayer,
  line: number[],
  backwards: boolean,
): void {
  const direction = backwards ? -1 : 1;
  let nextRow = row + rowStep * direction;
  let nextColumn = column + columnStep * direction;
  while (
    nextRow >= 0
    && nextRow < GOMOKU_SIZE
    && nextColumn >= 0
    && nextColumn < GOMOKU_SIZE
    && board[nextRow * GOMOKU_SIZE + nextColumn] === player
  ) {
    line.push(nextRow * GOMOKU_SIZE + nextColumn);
    nextRow += rowStep * direction;
    nextColumn += columnStep * direction;
  }
}

function otherPlayer(player: GomokuPlayer): GomokuPlayer {
  return player === 'black' ? 'white' : 'black';
}
