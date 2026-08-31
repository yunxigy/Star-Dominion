export const OTHELLO_SIZE = 8;

export type OthelloPlayer = 'black' | 'white';
export type OthelloCell = OthelloPlayer | null;
export type OthelloStatus = 'playing' | 'won' | 'draw';

export interface OthelloState {
  board: OthelloCell[];
  currentPlayer: OthelloPlayer;
  status: OthelloStatus;
  winner: OthelloPlayer | null;
  lastMove: number | null;
  lastPass: OthelloPlayer | null;
}

export interface OthelloResult {
  status: OthelloStatus;
  winner: OthelloPlayer | null;
}

const DIRECTIONS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

export function createOthelloState(): OthelloState {
  const board = Array<OthelloCell>(OTHELLO_SIZE * OTHELLO_SIZE).fill(null);
  board[27] = 'white';
  board[28] = 'black';
  board[35] = 'black';
  board[36] = 'white';
  return {
    board,
    currentPlayer: 'black',
    status: 'playing',
    winner: null,
    lastMove: null,
    lastPass: null,
  };
}

export function getOthelloLegalMoves(state: OthelloState): number[] {
  if (state.status !== 'playing') return [];
  return getLegalMovesForBoard(state.board, state.currentPlayer);
}

export function getOthelloResult(board: OthelloCell[]): OthelloResult {
  const hasMoves = getLegalMovesForBoard(board, 'black').length > 0
    || getLegalMovesForBoard(board, 'white').length > 0;
  if (hasMoves && board.some(cell => cell === null)) return { status: 'playing', winner: null };

  const blackCount = board.filter(cell => cell === 'black').length;
  const whiteCount = board.filter(cell => cell === 'white').length;
  if (blackCount === whiteCount) return { status: 'draw', winner: null };
  return { status: 'won', winner: blackCount > whiteCount ? 'black' : 'white' };
}

export function applyOthelloMove(state: OthelloState, index: number): OthelloState {
  if (state.status !== 'playing') {
    throw new Error('对局已结束');
  }
  if (!Number.isInteger(index) || index < 0 || index >= OTHELLO_SIZE * OTHELLO_SIZE || state.board[index] !== null) {
    throw new Error('非法落子');
  }

  const flips = getFlips(state.board, index, state.currentPlayer);
  if (flips.length === 0) {
    throw new Error('非法落子');
  }

  const board = [...state.board];
  board[index] = state.currentPlayer;
  flips.forEach(flipIndex => {
    board[flipIndex] = state.currentPlayer;
  });

  const opponent = otherPlayer(state.currentPlayer);
  const opponentMoves = getLegalMovesForBoard(board, opponent);
  const ownMoves = getLegalMovesForBoard(board, state.currentPlayer);
  const result = opponentMoves.length === 0 && ownMoves.length === 0
    ? getOthelloResult(board)
    : { status: 'playing' as const, winner: null };

  return {
    board,
    currentPlayer: result.status === 'playing'
      ? (opponentMoves.length > 0 ? opponent : state.currentPlayer)
      : state.currentPlayer,
    ...result,
    lastMove: index,
    lastPass: result.status === 'playing' && opponentMoves.length === 0 ? opponent : null,
  };
}

export function passOthelloTurn(state: OthelloState): OthelloState {
  if (state.status !== 'playing') return state;
  if (getLegalMovesForBoard(state.board, state.currentPlayer).length > 0) {
    throw new Error('当前仍有可落子');
  }

  const opponent = otherPlayer(state.currentPlayer);
  if (getLegalMovesForBoard(state.board, opponent).length === 0) {
    return { ...state, ...getOthelloResult(state.board), lastPass: state.currentPlayer };
  }

  return {
    ...state,
    currentPlayer: opponent,
    lastPass: state.currentPlayer,
  };
}

function getLegalMovesForBoard(board: OthelloCell[], player: OthelloPlayer): number[] {
  return board.reduce<number[]>((moves, cell, index) => {
    if (cell === null && getFlips(board, index, player).length > 0) moves.push(index);
    return moves;
  }, []);
}

function getFlips(board: OthelloCell[], index: number, player: OthelloPlayer): number[] {
  if (board[index] !== null) return [];
  const row = Math.floor(index / OTHELLO_SIZE);
  const column = index % OTHELLO_SIZE;
  const opponent = otherPlayer(player);
  const flips: number[] = [];

  for (const [rowStep, columnStep] of DIRECTIONS) {
    const line: number[] = [];
    let nextRow = row + rowStep;
    let nextColumn = column + columnStep;
    while (isInside(nextRow, nextColumn) && board[nextRow * OTHELLO_SIZE + nextColumn] === opponent) {
      line.push(nextRow * OTHELLO_SIZE + nextColumn);
      nextRow += rowStep;
      nextColumn += columnStep;
    }
    if (line.length > 0 && isInside(nextRow, nextColumn) && board[nextRow * OTHELLO_SIZE + nextColumn] === player) {
      flips.push(...line);
    }
  }

  return flips;
}

function isInside(row: number, column: number): boolean {
  return row >= 0 && row < OTHELLO_SIZE && column >= 0 && column < OTHELLO_SIZE;
}

function otherPlayer(player: OthelloPlayer): OthelloPlayer {
  return player === 'black' ? 'white' : 'black';
}
