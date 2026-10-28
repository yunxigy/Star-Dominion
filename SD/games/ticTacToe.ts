export type TicTacToePlayer = 'X' | 'O';
export type TicTacToeCell = TicTacToePlayer | null;
export type TicTacToeStatus = 'playing' | 'won' | 'draw';

export interface TicTacToeState {
  board: TicTacToeCell[];
  currentPlayer: TicTacToePlayer;
  status: TicTacToeStatus;
  winner: TicTacToePlayer | null;
  winningLine: number[];
}

export interface TicTacToeResult {
  status: TicTacToeStatus;
  winner: TicTacToePlayer | null;
  winningLine: number[];
}

const WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function createTicTacToeState(): TicTacToeState {
  return {
    board: Array(9).fill(null),
    currentPlayer: 'X',
    status: 'playing',
    winner: null,
    winningLine: [],
  };
}

export function getTicTacToeResult(board: TicTacToeCell[]): TicTacToeResult {
  for (const line of WINNING_LINES) {
    const [first, second, third] = line;
    const player = board[first];
    if (player && player === board[second] && player === board[third]) {
      return { status: 'won', winner: player, winningLine: [...line] };
    }
  }

  return board.every(Boolean)
    ? { status: 'draw', winner: null, winningLine: [] }
    : { status: 'playing', winner: null, winningLine: [] };
}

export function getTicTacToeLegalMoves(state: TicTacToeState): number[] {
  if (state.status !== 'playing') return [];
  return state.board.reduce<number[]>((moves, cell, index) => {
    if (cell === null) moves.push(index);
    return moves;
  }, []);
}

export function applyTicTacToeMove(state: TicTacToeState, index: number): TicTacToeState {
  if (state.status !== 'playing') {
    throw new Error('对局已结束');
  }
  if (!Number.isInteger(index) || index < 0 || index >= state.board.length || state.board[index] !== null) {
    throw new Error('非法落子');
  }

  const board = [...state.board];
  board[index] = state.currentPlayer;
  const result = getTicTacToeResult(board);

  return {
    board,
    currentPlayer: result.status === 'playing'
      ? (state.currentPlayer === 'X' ? 'O' : 'X')
      : state.currentPlayer,
    ...result,
  };
}
