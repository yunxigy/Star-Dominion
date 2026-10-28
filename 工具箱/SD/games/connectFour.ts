export const CONNECT_FOUR_ROWS = 6;
export const CONNECT_FOUR_COLUMNS = 7;

export type ConnectFourPlayer = 'red' | 'yellow';
export type ConnectFourCell = ConnectFourPlayer | null;
export type ConnectFourStatus = 'playing' | 'won' | 'draw';

export interface ConnectFourState {
  board: ConnectFourCell[];
  currentPlayer: ConnectFourPlayer;
  status: ConnectFourStatus;
  winner: ConnectFourPlayer | null;
  winningLine: number[];
}

export interface ConnectFourResult {
  status: ConnectFourStatus;
  winner: ConnectFourPlayer | null;
  winningLine: number[];
}

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

export function createConnectFourState(): ConnectFourState {
  return {
    board: Array(CONNECT_FOUR_ROWS * CONNECT_FOUR_COLUMNS).fill(null),
    currentPlayer: 'red',
    status: 'playing',
    winner: null,
    winningLine: [],
  };
}

export function getConnectFourLegalColumns(state: ConnectFourState): number[] {
  if (state.status !== 'playing') return [];
  return Array.from({ length: CONNECT_FOUR_COLUMNS }, (_, column) => column)
    .filter(column => state.board[column] === null);
}

export function getConnectFourResult(board: ConnectFourCell[], lastMove?: number): ConnectFourResult {
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
    if (winningLine.length >= 4) {
      return { status: 'won', winner: player, winningLine };
    }
  }

  return board.every(Boolean)
    ? { status: 'draw', winner: null, winningLine: [] }
    : { status: 'playing', winner: null, winningLine: [] };
}

export function applyConnectFourMove(state: ConnectFourState, column: number): ConnectFourState {
  if (state.status !== 'playing') {
    throw new Error('对局已结束');
  }
  if (!Number.isInteger(column) || column < 0 || column >= CONNECT_FOUR_COLUMNS) {
    throw new Error('非法落子');
  }

  let row = CONNECT_FOUR_ROWS - 1;
  while (row >= 0 && state.board[row * CONNECT_FOUR_COLUMNS + column] !== null) row -= 1;
  if (row < 0) {
    throw new Error('该列已满');
  }

  const index = row * CONNECT_FOUR_COLUMNS + column;
  const board = [...state.board];
  board[index] = state.currentPlayer;
  const result = getConnectFourResult(board, index);

  return {
    board,
    currentPlayer: result.status === 'playing' ? otherPlayer(state.currentPlayer) : state.currentPlayer,
    ...result,
  };
}

function findWinningLine(board: ConnectFourCell[], index: number, player: ConnectFourPlayer): number[] {
  const row = Math.floor(index / CONNECT_FOUR_COLUMNS);
  const column = index % CONNECT_FOUR_COLUMNS;

  for (const [rowStep, columnStep] of DIRECTIONS) {
    const line = [index];
    collectDirection(board, row, column, rowStep, columnStep, player, line, false);
    collectDirection(board, row, column, rowStep, columnStep, player, line, true);
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }

  return [];
}

function collectDirection(
  board: ConnectFourCell[],
  row: number,
  column: number,
  rowStep: number,
  columnStep: number,
  player: ConnectFourPlayer,
  line: number[],
  backwards: boolean,
): void {
  const direction = backwards ? -1 : 1;
  let nextRow = row + rowStep * direction;
  let nextColumn = column + columnStep * direction;
  while (
    nextRow >= 0
    && nextRow < CONNECT_FOUR_ROWS
    && nextColumn >= 0
    && nextColumn < CONNECT_FOUR_COLUMNS
    && board[nextRow * CONNECT_FOUR_COLUMNS + nextColumn] === player
  ) {
    line.push(nextRow * CONNECT_FOUR_COLUMNS + nextColumn);
    nextRow += rowStep * direction;
    nextColumn += columnStep * direction;
  }
}

function otherPlayer(player: ConnectFourPlayer): ConnectFourPlayer {
  return player === 'red' ? 'yellow' : 'red';
}
