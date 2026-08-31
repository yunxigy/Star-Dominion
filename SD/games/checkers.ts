export const CHECKERS_SIZE = 8;
export const CHECKERS_BOARD_CELLS = CHECKERS_SIZE * CHECKERS_SIZE;

export type CheckersPlayer = 'black' | 'red';
export type CheckersCell = CheckersPiece | null;
export type CheckersStatus = 'playing' | 'won' | 'draw';

export interface CheckersPiece {
  player: CheckersPlayer;
  king: boolean;
}

export interface CheckersMove {
  path: number[];
  captures: number[];
}

export interface CheckersState {
  board: CheckersCell[];
  currentPlayer: CheckersPlayer;
  status: CheckersStatus;
  winner: CheckersPlayer | null;
  lastMove: CheckersMove | null;
}

export function createCheckersState(): CheckersState {
  const board = Array<CheckersCell>(CHECKERS_BOARD_CELLS).fill(null);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < CHECKERS_SIZE; column += 1) {
      if (isPlayableSquare(row, column)) board[indexOf(row, column)] = { player: 'black', king: false };
    }
  }
  for (let row = 5; row < CHECKERS_SIZE; row += 1) {
    for (let column = 0; column < CHECKERS_SIZE; column += 1) {
      if (isPlayableSquare(row, column)) board[indexOf(row, column)] = { player: 'red', king: false };
    }
  }
  return {
    board,
    currentPlayer: 'black',
    status: 'playing',
    winner: null,
    lastMove: null,
  };
}

export function getCheckersLegalMoves(state: CheckersState, from?: number): CheckersMove[] {
  if (state.status !== 'playing') return [];
  const pieces = state.board.reduce<number[]>((indices, piece, index) => {
    if (piece?.player === state.currentPlayer && (from === undefined || from === index)) indices.push(index);
    return indices;
  }, []);
  const captures = pieces.flatMap(index => getCaptureMoves(state.board, index, state.board[index]!));
  if (captures.length > 0) return captures;
  return pieces.flatMap(index => getQuietMoves(state.board, index, state.board[index]!));
}

export function applyCheckersMove(state: CheckersState, requestedMove: CheckersMove): CheckersState {
  if (state.status !== 'playing') throw new Error('对局已结束');
  const move = getCheckersLegalMoves(state).find(candidate => sameMove(candidate, requestedMove));
  if (!move) throw new Error('非法走法');

  const board = applyMoveToBoard(state.board, move);
  const opponent = otherPlayer(state.currentPlayer);
  const interim: CheckersState = {
    board,
    currentPlayer: opponent,
    status: 'playing',
    winner: null,
    lastMove: move,
  };
  const opponentHasPieces = board.some(piece => piece?.player === opponent);
  if (!opponentHasPieces) return { ...interim, status: 'won', winner: state.currentPlayer };
  if (getCheckersLegalMoves(interim).length === 0) return { ...interim, status: 'won', winner: state.currentPlayer };
  return interim;
}

function getQuietMoves(board: CheckersCell[], from: number, piece: CheckersPiece): CheckersMove[] {
  const row = Math.floor(from / CHECKERS_SIZE);
  const column = from % CHECKERS_SIZE;
  const directions = piece.king ? [-1, 1] : [piece.player === 'black' ? 1 : -1];
  const moves: CheckersMove[] = [];
  directions.forEach(rowStep => {
    for (const columnStep of [-1, 1]) {
      const target = indexOf(row + rowStep, column + columnStep);
      if (target >= 0 && board[target] === null) moves.push({ path: [from, target], captures: [] });
    }
  });
  return moves;
}

function getCaptureMoves(
  board: CheckersCell[],
  from: number,
  piece: CheckersPiece,
  path: number[] = [from],
  captures: number[] = [],
): CheckersMove[] {
  const row = Math.floor(from / CHECKERS_SIZE);
  const column = from % CHECKERS_SIZE;
  // Men move forward quietly, but standard checkers lets them capture in either direction.
  const directions = [-1, 1];
  const moves: CheckersMove[] = [];
  let foundCapture = false;

  directions.forEach(rowStep => {
    for (const columnStep of [-1, 1]) {
      const jumped = indexOf(row + rowStep, column + columnStep);
      const target = indexOf(row + rowStep * 2, column + columnStep * 2);
      const jumpedPiece = jumped >= 0 ? board[jumped] : null;
      if (target < 0 || !jumpedPiece || jumpedPiece.player === piece.player || board[target] !== null) continue;
      foundCapture = true;
      const nextBoard = [...board];
      nextBoard[from] = null;
      nextBoard[jumped] = null;
      const promoted = !piece.king && isPromotionRow(Math.floor(target / CHECKERS_SIZE), piece.player);
      const nextPiece = promoted ? { ...piece, king: true } : piece;
      nextBoard[target] = nextPiece;
      const nextPath = [...path, target];
      const nextCaptures = [...captures, jumped];
      if (promoted) {
        moves.push({ path: nextPath, captures: nextCaptures });
      } else {
        const continuations = getCaptureMoves(nextBoard, target, nextPiece, nextPath, nextCaptures);
        moves.push(...(continuations.length > 0 ? continuations : [{ path: nextPath, captures: nextCaptures }]));
      }
    }
  });
  return foundCapture ? moves : [];
}

function applyMoveToBoard(board: CheckersCell[], move: CheckersMove): CheckersCell[] {
  const next = [...board];
  const first = move.path[0];
  let piece = next[first];
  next[first] = null;
  for (let step = 1; step < move.path.length; step += 1) {
    const target = move.path[step];
    const captured = move.captures[step - 1];
    if (captured !== undefined) next[captured] = null;
    next[target] = null;
  }
  const final = move.path[move.path.length - 1];
  if (piece && !piece.king && isPromotionRow(Math.floor(final / CHECKERS_SIZE), piece.player)) piece = { ...piece, king: true };
  next[final] = piece;
  return next;
}

function sameMove(left: CheckersMove, right: CheckersMove): boolean {
  return left.path.length === right.path.length
    && left.captures.length === right.captures.length
    && left.path.every((index, position) => index === right.path[position])
    && left.captures.every((index, position) => index === right.captures[position]);
}

function isPromotionRow(row: number, player: CheckersPlayer): boolean {
  return player === 'black' ? row === CHECKERS_SIZE - 1 : row === 0;
}

function isPlayableSquare(row: number, column: number): boolean {
  return (row + column) % 2 === 1;
}

function indexOf(row: number, column: number): number {
  return row >= 0 && row < CHECKERS_SIZE && column >= 0 && column < CHECKERS_SIZE ? row * CHECKERS_SIZE + column : -1;
}

function otherPlayer(player: CheckersPlayer): CheckersPlayer {
  return player === 'black' ? 'red' : 'black';
}
