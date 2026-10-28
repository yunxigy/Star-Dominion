export const XIANGQI_ROWS = 10;
export const XIANGQI_COLUMNS = 9;
export const XIANGQI_BOARD_CELLS = XIANGQI_ROWS * XIANGQI_COLUMNS;

export type XiangqiColor = 'red' | 'black';
export type XiangqiPieceType = 'general' | 'advisor' | 'elephant' | 'horse' | 'chariot' | 'cannon' | 'soldier';
export type XiangqiCell = XiangqiPiece | null;
export type XiangqiStatus = 'playing' | 'checkmate' | 'stalemate' | 'won';

export interface XiangqiPiece {
  color: XiangqiColor;
  type: XiangqiPieceType;
}

export interface XiangqiMove {
  from: number;
  to: number;
}

export interface XiangqiState {
  board: XiangqiCell[];
  currentPlayer: XiangqiColor;
  status: XiangqiStatus;
  winner: XiangqiColor | null;
  lastMove: XiangqiMove | null;
}

const ORTHOGONAL_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIAGONAL_STEPS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const HORSE_STEPS = [
  [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
  [1, 2, 0, 1], [1, -2, 0, -1], [-1, 2, 0, 1], [-1, -2, 0, -1],
] as const;

export function createXiangqiState(): XiangqiState {
  const board = Array<XiangqiCell>(XIANGQI_BOARD_CELLS).fill(null);
  const backRank: XiangqiPieceType[] = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot'];
  backRank.forEach((type, column) => {
    board[indexOf(0, column)] = { color: 'black', type };
    board[indexOf(9, column)] = { color: 'red', type };
  });
  [1, 7].forEach(column => {
    board[indexOf(2, column)] = { color: 'black', type: 'cannon' };
    board[indexOf(7, column)] = { color: 'red', type: 'cannon' };
  });
  [0, 2, 4, 6, 8].forEach(column => {
    board[indexOf(3, column)] = { color: 'black', type: 'soldier' };
    board[indexOf(6, column)] = { color: 'red', type: 'soldier' };
  });
  return {
    board,
    currentPlayer: 'red',
    status: 'playing',
    winner: null,
    lastMove: null,
  };
}

export function getXiangqiLegalMoves(state: XiangqiState, from?: number): XiangqiMove[] {
  if (state.status !== 'playing') return [];
  const pseudoMoves = generatePseudoMoves(state.board, state.currentPlayer, from);
  return pseudoMoves.filter(move => {
    const board = applyMoveToBoard(state.board, move);
    const ownGeneral = findGeneral(board, state.currentPlayer);
    return ownGeneral >= 0 && !isSquareAttacked(board, ownGeneral, otherColor(state.currentPlayer));
  });
}

export function isXiangqiInCheck(state: XiangqiState, color: XiangqiColor): boolean {
  const general = findGeneral(state.board, color);
  return general < 0 || isSquareAttacked(state.board, general, otherColor(color));
}

export function applyXiangqiMove(state: XiangqiState, requestedMove: XiangqiMove): XiangqiState {
  if (state.status !== 'playing') throw new Error('对局已结束');
  const move = getXiangqiLegalMoves(state).find(candidate => candidate.from === requestedMove.from && candidate.to === requestedMove.to);
  if (!move) throw new Error('非法走法');

  const board = applyMoveToBoard(state.board, move);
  const opponent = otherColor(state.currentPlayer);
  const opponentGeneral = findGeneral(board, opponent);
  const interim: XiangqiState = {
    board,
    currentPlayer: opponent,
    status: 'playing',
    winner: null,
    lastMove: move,
  };
  if (opponentGeneral < 0) return { ...interim, status: 'won', winner: state.currentPlayer };

  const replies = getXiangqiLegalMoves(interim);
  if (replies.length > 0) return interim;
  if (isXiangqiInCheck(interim, opponent)) return { ...interim, status: 'checkmate', winner: state.currentPlayer };
  return { ...interim, status: 'stalemate', winner: state.currentPlayer };
}

function generatePseudoMoves(board: XiangqiCell[], color: XiangqiColor, from?: number): XiangqiMove[] {
  const moves: XiangqiMove[] = [];
  board.forEach((piece, index) => {
    if (!piece || piece.color !== color || (from !== undefined && from !== index)) return;
    const row = Math.floor(index / XIANGQI_COLUMNS);
    const column = index % XIANGQI_COLUMNS;
    const addStep = (targetRow: number, targetColumn: number) => {
      if (!isOnBoard(targetRow, targetColumn)) return;
      const target = board[indexOf(targetRow, targetColumn)];
      if (!target || target.color !== color) moves.push({ from: index, to: indexOf(targetRow, targetColumn) });
    };

    switch (piece.type) {
      case 'general':
        ORTHOGONAL_STEPS.forEach(([rowStep, columnStep]) => {
          const targetRow = row + rowStep;
          const targetColumn = column + columnStep;
          if (isInPalace(targetRow, targetColumn, color)) addStep(targetRow, targetColumn);
        });
        break;
      case 'advisor':
        DIAGONAL_STEPS.forEach(([rowStep, columnStep]) => {
          const targetRow = row + rowStep;
          const targetColumn = column + columnStep;
          if (isInPalace(targetRow, targetColumn, color)) addStep(targetRow, targetColumn);
        });
        break;
      case 'elephant':
        DIAGONAL_STEPS.forEach(([rowStep, columnStep]) => {
          const targetRow = row + rowStep * 2;
          const targetColumn = column + columnStep * 2;
          const eye = indexOf(row + rowStep, column + columnStep);
          if (isOnBoard(targetRow, targetColumn) && isOnOwnSide(targetRow, color) && board[eye] === null) {
            addStep(targetRow, targetColumn);
          }
        });
        break;
      case 'horse':
        HORSE_STEPS.forEach(([rowStep, columnStep, legRow, legColumn]) => {
          if (board[indexOf(row + legRow, column + legColumn)] === null) addStep(row + rowStep, column + columnStep);
        });
        break;
      case 'chariot':
        addSlidingMoves(board, index, color, ORTHOGONAL_STEPS, moves);
        break;
      case 'cannon':
        addCannonMoves(board, index, color, moves);
        break;
      case 'soldier': {
        const forward = color === 'red' ? -1 : 1;
        addStep(row + forward, column);
        if (!isBeforeRiver(row, color)) {
          addStep(row, column - 1);
          addStep(row, column + 1);
        }
        break;
      }
      default:
        break;
    }
  });
  return moves;
}

function addSlidingMoves(
  board: XiangqiCell[],
  from: number,
  color: XiangqiColor,
  directions: readonly (readonly [number, number])[],
  moves: XiangqiMove[],
): void {
  const row = Math.floor(from / XIANGQI_COLUMNS);
  const column = from % XIANGQI_COLUMNS;
  directions.forEach(([rowStep, columnStep]) => {
    let nextRow = row + rowStep;
    let nextColumn = column + columnStep;
    while (isOnBoard(nextRow, nextColumn)) {
      const target = board[indexOf(nextRow, nextColumn)];
      if (!target) {
        moves.push({ from, to: indexOf(nextRow, nextColumn) });
      } else {
        if (target.color !== color) moves.push({ from, to: indexOf(nextRow, nextColumn) });
        break;
      }
      nextRow += rowStep;
      nextColumn += columnStep;
    }
  });
}

function addCannonMoves(board: XiangqiCell[], from: number, color: XiangqiColor, moves: XiangqiMove[]): void {
  const row = Math.floor(from / XIANGQI_COLUMNS);
  const column = from % XIANGQI_COLUMNS;
  ORTHOGONAL_STEPS.forEach(([rowStep, columnStep]) => {
    let nextRow = row + rowStep;
    let nextColumn = column + columnStep;
    let screenFound = false;
    while (isOnBoard(nextRow, nextColumn)) {
      const target = board[indexOf(nextRow, nextColumn)];
      if (!screenFound) {
        if (!target) {
          moves.push({ from, to: indexOf(nextRow, nextColumn) });
        } else {
          screenFound = true;
        }
      } else if (target) {
        if (target.color !== color) moves.push({ from, to: indexOf(nextRow, nextColumn) });
        break;
      }
      nextRow += rowStep;
      nextColumn += columnStep;
    }
  });
}

function isSquareAttacked(board: XiangqiCell[], target: number, byColor: XiangqiColor): boolean {
  for (let from = 0; from < board.length; from += 1) {
    const piece = board[from];
    if (piece?.color === byColor && pieceAttacksSquare(board, from, piece, target)) return true;
  }
  return false;
}

function pieceAttacksSquare(board: XiangqiCell[], from: number, piece: XiangqiPiece, target: number): boolean {
  const fromRow = Math.floor(from / XIANGQI_COLUMNS);
  const fromColumn = from % XIANGQI_COLUMNS;
  const targetRow = Math.floor(target / XIANGQI_COLUMNS);
  const targetColumn = target % XIANGQI_COLUMNS;
  const rowDistance = targetRow - fromRow;
  const columnDistance = targetColumn - fromColumn;

  if (piece.type === 'soldier') {
    const forward = piece.color === 'red' ? -1 : 1;
    if (rowDistance === forward && columnDistance === 0) return true;
    return rowDistance === 0 && Math.abs(columnDistance) === 1 && !isBeforeRiver(fromRow, piece.color);
  }
  if (piece.type === 'general') {
    if (Math.abs(rowDistance) + Math.abs(columnDistance) === 1 && isInPalace(targetRow, targetColumn, piece.color)) return true;
    return columnDistance === 0 && hasClearLine(board, from, target);
  }
  if (piece.type === 'advisor') return Math.abs(rowDistance) === 1 && Math.abs(columnDistance) === 1 && isInPalace(targetRow, targetColumn, piece.color);
  if (piece.type === 'elephant') {
    if (Math.abs(rowDistance) !== 2 || Math.abs(columnDistance) !== 2 || !isOnOwnSide(targetRow, piece.color)) return false;
    return board[indexOf(fromRow + rowDistance / 2, fromColumn + columnDistance / 2)] === null;
  }
  if (piece.type === 'horse') {
    if (!((Math.abs(rowDistance) === 2 && Math.abs(columnDistance) === 1) || (Math.abs(rowDistance) === 1 && Math.abs(columnDistance) === 2))) return false;
    const legRow = fromRow + (Math.abs(rowDistance) === 2 ? Math.sign(rowDistance) : 0);
    const legColumn = fromColumn + (Math.abs(columnDistance) === 2 ? Math.sign(columnDistance) : 0);
    return board[indexOf(legRow, legColumn)] === null;
  }
  const sameLine = rowDistance === 0 || columnDistance === 0;
  if (!sameLine) return false;
  const screens = countBetween(board, from, target);
  if (piece.type === 'chariot') return screens === 0;
  return screens === 1;
}

function applyMoveToBoard(board: XiangqiCell[], move: XiangqiMove): XiangqiCell[] {
  const next = [...board];
  next[move.to] = next[move.from];
  next[move.from] = null;
  return next;
}

function findGeneral(board: XiangqiCell[], color: XiangqiColor): number {
  return board.findIndex(piece => piece?.color === color && piece.type === 'general');
}

function hasClearLine(board: XiangqiCell[], from: number, target: number): boolean {
  return countBetween(board, from, target) === 0;
}

function countBetween(board: XiangqiCell[], from: number, target: number): number {
  const fromRow = Math.floor(from / XIANGQI_COLUMNS);
  const fromColumn = from % XIANGQI_COLUMNS;
  const targetRow = Math.floor(target / XIANGQI_COLUMNS);
  const targetColumn = target % XIANGQI_COLUMNS;
  if (fromRow !== targetRow && fromColumn !== targetColumn) return Number.POSITIVE_INFINITY;
  const rowStep = Math.sign(targetRow - fromRow);
  const columnStep = Math.sign(targetColumn - fromColumn);
  let row = fromRow + rowStep;
  let column = fromColumn + columnStep;
  let count = 0;
  while (row !== targetRow || column !== targetColumn) {
    if (board[indexOf(row, column)] !== null) count += 1;
    row += rowStep;
    column += columnStep;
  }
  return count;
}

function isInPalace(row: number, column: number, color: XiangqiColor): boolean {
  return column >= 3 && column <= 5 && row >= (color === 'red' ? 7 : 0) && row <= (color === 'red' ? 9 : 2);
}

function isOnOwnSide(row: number, color: XiangqiColor): boolean {
  return color === 'red' ? row >= 5 : row <= 4;
}

function isBeforeRiver(row: number, color: XiangqiColor): boolean {
  return color === 'red' ? row >= 5 : row <= 4;
}

function indexOf(row: number, column: number): number {
  return isOnBoard(row, column) ? row * XIANGQI_COLUMNS + column : -1;
}

function isOnBoard(row: number, column: number): boolean {
  return row >= 0 && row < XIANGQI_ROWS && column >= 0 && column < XIANGQI_COLUMNS;
}

function otherColor(color: XiangqiColor): XiangqiColor {
  return color === 'red' ? 'black' : 'red';
}
