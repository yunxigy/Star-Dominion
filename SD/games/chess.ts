export const CHESS_SIZE = 8;
export const CHESS_BOARD_CELLS = CHESS_SIZE * CHESS_SIZE;

export type ChessColor = 'white' | 'black';
export type ChessPieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type ChessCell = ChessPiece | null;
export type ChessStatus = 'playing' | 'checkmate' | 'stalemate' | 'draw';

export interface ChessPiece {
  color: ChessColor;
  type: ChessPieceType;
}

export interface ChessCastlingRights {
  whiteKingSide: boolean;
  whiteQueenSide: boolean;
  blackKingSide: boolean;
  blackQueenSide: boolean;
}

export interface ChessMove {
  from: number;
  to: number;
  promotion?: Extract<ChessPieceType, 'queen' | 'rook' | 'bishop' | 'knight'>;
  isEnPassant?: boolean;
  isCastling?: 'king-side' | 'queen-side';
}

export interface ChessState {
  board: ChessCell[];
  currentPlayer: ChessColor;
  status: ChessStatus;
  winner: ChessColor | null;
  lastMove: ChessMove | null;
  castlingRights: ChessCastlingRights;
  enPassantTarget: number | null;
  halfmoveClock: number;
}

const DIRECTIONS = {
  bishop: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  rook: [[1, 0], [-1, 0], [0, 1], [0, -1]],
} as const;
const KNIGHT_STEPS = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]] as const;
const KING_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const PROMOTIONS: Array<Extract<ChessPieceType, 'queen' | 'rook' | 'bishop' | 'knight'>> = ['queen', 'rook', 'bishop', 'knight'];

export function createChessState(): ChessState {
  const board = Array<ChessCell>(CHESS_BOARD_CELLS).fill(null);
  const backRank: ChessPieceType[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  backRank.forEach((type, column) => {
    board[column] = { color: 'black', type };
    board[CHESS_BOARD_CELLS - CHESS_SIZE + column] = { color: 'white', type };
    board[CHESS_SIZE + column] = { color: 'black', type: 'pawn' };
    board[CHESS_BOARD_CELLS - (CHESS_SIZE * 2) + column] = { color: 'white', type: 'pawn' };
  });

  return {
    board,
    currentPlayer: 'white',
    status: 'playing',
    winner: null,
    lastMove: null,
    castlingRights: {
      whiteKingSide: true,
      whiteQueenSide: true,
      blackKingSide: true,
      blackQueenSide: true,
    },
    enPassantTarget: null,
    halfmoveClock: 0,
  };
}

export function getChessLegalMoves(state: ChessState, from?: number): ChessMove[] {
  if (state.status !== 'playing') return [];
  const pseudoMoves = generatePseudoMoves(state, state.currentPlayer);
  return pseudoMoves.filter(move => {
    if (from !== undefined && move.from !== from) return false;
    const board = applyMoveToBoard(state, move);
    const kingIndex = findKing(board, state.currentPlayer);
    return kingIndex >= 0 && !isSquareAttacked(board, kingIndex, otherColor(state.currentPlayer));
  });
}

export function isChessInCheck(state: ChessState, color: ChessColor): boolean {
  const kingIndex = findKing(state.board, color);
  return kingIndex < 0 || isSquareAttacked(state.board, kingIndex, otherColor(color));
}

export function applyChessMove(state: ChessState, requestedMove: ChessMove): ChessState {
  if (state.status !== 'playing') throw new Error('对局已结束');

  const candidates = getChessLegalMoves(state).filter(move => move.from === requestedMove.from && move.to === requestedMove.to);
  const move = requestedMove.promotion
    ? candidates.find(candidate => candidate.promotion === requestedMove.promotion)
    : candidates.find(candidate => candidate.promotion === 'queen') ?? candidates[0];
  if (!move) throw new Error('非法走法');

  const board = applyMoveToBoard(state, move);
  const nextPlayer = otherColor(state.currentPlayer);
  const castlingRights = updateCastlingRights(state, move, board);
  const enPassantTarget = getEnPassantTarget(state, move);
  const halfmoveClock = state.board[move.from]?.type === 'pawn' || state.board[move.to] !== null || move.isEnPassant
    ? 0
    : state.halfmoveClock + 1;
  const interim: ChessState = {
    board,
    currentPlayer: nextPlayer,
    status: 'playing',
    winner: null,
    lastMove: move,
    castlingRights,
    enPassantTarget,
    halfmoveClock,
  };

  if (halfmoveClock >= 100 || isInsufficientMaterial(board)) {
    return { ...interim, status: 'draw' };
  }

  const opponentMoves = getChessLegalMoves(interim);
  if (opponentMoves.length > 0) return interim;
  if (isChessInCheck(interim, nextPlayer)) {
    return { ...interim, status: 'checkmate', winner: state.currentPlayer };
  }
  return { ...interim, status: 'stalemate' };
}

function generatePseudoMoves(state: ChessState, color: ChessColor): ChessMove[] {
  const moves: ChessMove[] = [];
  state.board.forEach((piece, from) => {
    if (!piece || piece.color !== color) return;
    const row = Math.floor(from / CHESS_SIZE);
    const column = from % CHESS_SIZE;
    const addStep = (to: number, metadata: Partial<ChessMove> = {}) => {
      if (!isOnBoardIndex(to)) return;
      const target = state.board[to];
      if (target?.color === color || target?.type === 'king') return;
      moves.push({ from, to, ...metadata });
    };

    if (piece.type === 'pawn') {
      const direction = color === 'white' ? -1 : 1;
      const startRow = color === 'white' ? 6 : 1;
      const promotionRow = color === 'white' ? 0 : 7;
      const oneRow = row + direction;
      const oneStep = indexOf(oneRow, column);
      if (isOnBoardIndex(oneStep) && state.board[oneStep] === null) {
        addPawnMove(moves, from, oneStep, oneRow === promotionRow);
        const twoStep = indexOf(row + direction * 2, column);
        if (row === startRow && state.board[twoStep] === null) moves.push({ from, to: twoStep });
      }
      for (const deltaColumn of [-1, 1]) {
        const target = indexOf(oneRow, column + deltaColumn);
        if (!isOnBoardIndex(target)) continue;
        const targetPiece = state.board[target];
        if (targetPiece && targetPiece.color !== color && targetPiece.type !== 'king') {
          addPawnMove(moves, from, target, oneRow === promotionRow);
        } else if (
          target === state.enPassantTarget
          && targetPiece === null
          && state.board[indexOf(row, column + deltaColumn)]?.type === 'pawn'
          && state.board[indexOf(row, column + deltaColumn)]?.color !== color
        ) {
          moves.push({ from, to: target, isEnPassant: true });
        }
      }
      return;
    }

    if (piece.type === 'knight' || piece.type === 'king') {
      const steps = piece.type === 'knight' ? KNIGHT_STEPS : KING_STEPS;
      steps.forEach(([rowStep, columnStep]) => {
        const target = indexOf(row + rowStep, column + columnStep);
        addStep(target);
      });
      if (piece.type === 'king') addCastlingMoves(state, color, from, moves);
      return;
    }

    const directions = piece.type === 'bishop'
      ? DIRECTIONS.bishop
      : piece.type === 'rook'
        ? DIRECTIONS.rook
        : [...DIRECTIONS.bishop, ...DIRECTIONS.rook];
    directions.forEach(([rowStep, columnStep]) => {
      let nextRow = row + rowStep;
      let nextColumn = column + columnStep;
      while (isOnBoard(nextRow, nextColumn)) {
        const target = indexOf(nextRow, nextColumn);
        const targetPiece = state.board[target];
        if (!targetPiece) {
          moves.push({ from, to: target });
        } else {
          if (targetPiece.color !== color && targetPiece.type !== 'king') moves.push({ from, to: target });
          break;
        }
        nextRow += rowStep;
        nextColumn += columnStep;
      }
    });
  });
  return moves;
}

function addPawnMove(moves: ChessMove[], from: number, to: number, promotion: boolean): void {
  if (promotion) PROMOTIONS.forEach(type => moves.push({ from, to, promotion: type }));
  else moves.push({ from, to });
}

function addCastlingMoves(state: ChessState, color: ChessColor, from: number, moves: ChessMove[]): void {
  const homeRow = color === 'white' ? 7 : 0;
  if (from !== indexOf(homeRow, 4) || isChessInCheck(state, color)) return;
  const opponent = otherColor(color);
  const rights = state.castlingRights;
  const kingSide = color === 'white' ? rights.whiteKingSide : rights.blackKingSide;
  const queenSide = color === 'white' ? rights.whiteQueenSide : rights.blackQueenSide;
  if (kingSide) {
    const rook = indexOf(homeRow, 7);
    const transit = indexOf(homeRow, 5);
    const target = indexOf(homeRow, 6);
    if (state.board[rook]?.type === 'rook' && state.board[rook]?.color === color
      && state.board[transit] === null && state.board[target] === null
      && !isSquareAttacked(state.board, transit, opponent) && !isSquareAttacked(state.board, target, opponent)) {
      moves.push({ from, to: target, isCastling: 'king-side' });
    }
  }
  if (queenSide) {
    const rook = indexOf(homeRow, 0);
    const transit = indexOf(homeRow, 3);
    const target = indexOf(homeRow, 2);
    const between = indexOf(homeRow, 1);
    if (state.board[rook]?.type === 'rook' && state.board[rook]?.color === color
      && state.board[between] === null && state.board[transit] === null && state.board[target] === null
      && !isSquareAttacked(state.board, transit, opponent) && !isSquareAttacked(state.board, target, opponent)) {
      moves.push({ from, to: target, isCastling: 'queen-side' });
    }
  }
}

function applyMoveToBoard(state: ChessState, move: ChessMove): ChessCell[] {
  const board = [...state.board];
  const piece = board[move.from];
  if (!piece) return board;
  board[move.from] = null;

  if (move.isEnPassant) {
    const direction = piece.color === 'white' ? -1 : 1;
    board[indexOf(Math.floor(move.to / CHESS_SIZE) - direction, move.to % CHESS_SIZE)] = null;
  }

  let movedPiece: ChessPiece = piece;
  if (piece.type === 'pawn' && (Math.floor(move.to / CHESS_SIZE) === 0 || Math.floor(move.to / CHESS_SIZE) === 7)) {
    movedPiece = { color: piece.color, type: move.promotion ?? 'queen' };
  }
  board[move.to] = movedPiece;

  if (move.isCastling || (piece.type === 'king' && Math.abs((move.to % CHESS_SIZE) - (move.from % CHESS_SIZE)) === 2)) {
    const row = Math.floor(move.from / CHESS_SIZE);
    const kingSide = move.to > move.from;
    const rookFrom = indexOf(row, kingSide ? 7 : 0);
    const rookTo = indexOf(row, kingSide ? 5 : 3);
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  return board;
}

function updateCastlingRights(state: ChessState, move: ChessMove, nextBoard: ChessCell[]): ChessCastlingRights {
  const rights = { ...state.castlingRights };
  const piece = state.board[move.from];
  if (piece?.type === 'king') {
    if (piece.color === 'white') {
      rights.whiteKingSide = false;
      rights.whiteQueenSide = false;
    } else {
      rights.blackKingSide = false;
      rights.blackQueenSide = false;
    }
  }
  if (piece?.type === 'rook') disableRookRight(rights, piece.color, move.from);
  const capturedRook = state.board[move.to];
  if (capturedRook?.type === 'rook') disableRookRight(rights, capturedRook.color, move.to);
  if (nextBoard[0]?.type !== 'rook' || nextBoard[0]?.color !== 'black') rights.blackQueenSide = false;
  if (nextBoard[7]?.type !== 'rook' || nextBoard[7]?.color !== 'black') rights.blackKingSide = false;
  if (nextBoard[56]?.type !== 'rook' || nextBoard[56]?.color !== 'white') rights.whiteQueenSide = false;
  if (nextBoard[63]?.type !== 'rook' || nextBoard[63]?.color !== 'white') rights.whiteKingSide = false;
  return rights;
}

function disableRookRight(rights: ChessCastlingRights, color: ChessColor, index: number): void {
  if (color === 'white' && index === 56) rights.whiteQueenSide = false;
  if (color === 'white' && index === 63) rights.whiteKingSide = false;
  if (color === 'black' && index === 0) rights.blackQueenSide = false;
  if (color === 'black' && index === 7) rights.blackKingSide = false;
}

function getEnPassantTarget(state: ChessState, move: ChessMove): number | null {
  const piece = state.board[move.from];
  if (piece?.type !== 'pawn') return null;
  if (Math.abs(Math.floor(move.to / CHESS_SIZE) - Math.floor(move.from / CHESS_SIZE)) !== 2) return null;
  return (move.from + move.to) / 2;
}

function isSquareAttacked(board: ChessCell[], target: number, byColor: ChessColor): boolean {
  const row = Math.floor(target / CHESS_SIZE);
  const column = target % CHESS_SIZE;
  const pawnRow = row - (byColor === 'white' ? -1 : 1);
  for (const pawnColumn of [column - 1, column + 1]) {
    const pawn = board[indexOf(pawnRow, pawnColumn)];
    if (pawn?.color === byColor && pawn.type === 'pawn') return true;
  }
  for (const [rowStep, columnStep] of KNIGHT_STEPS) {
    const piece = board[indexOf(row + rowStep, column + columnStep)];
    if (piece?.color === byColor && piece.type === 'knight') return true;
  }
  for (const [rowStep, columnStep] of KING_STEPS) {
    const piece = board[indexOf(row + rowStep, column + columnStep)];
    if (piece?.color === byColor && piece.type === 'king') return true;
  }
  if (hasSlidingAttack(board, row, column, byColor, DIRECTIONS.bishop, ['bishop', 'queen'])) return true;
  return hasSlidingAttack(board, row, column, byColor, DIRECTIONS.rook, ['rook', 'queen']);
}

function hasSlidingAttack(
  board: ChessCell[],
  row: number,
  column: number,
  byColor: ChessColor,
  directions: readonly (readonly [number, number])[],
  types: ChessPieceType[],
): boolean {
  for (const [rowStep, columnStep] of directions) {
    let nextRow = row + rowStep;
    let nextColumn = column + columnStep;
    while (isOnBoard(nextRow, nextColumn)) {
      const piece = board[indexOf(nextRow, nextColumn)];
      if (!piece) {
        nextRow += rowStep;
        nextColumn += columnStep;
        continue;
      }
      if (piece.color === byColor && types.includes(piece.type)) return true;
      break;
    }
  }
  return false;
}

function isInsufficientMaterial(board: ChessCell[]): boolean {
  const pieces = board.filter((piece): piece is ChessPiece => piece !== null && piece.type !== 'king');
  if (pieces.some(piece => ['pawn', 'rook', 'queen'].includes(piece.type))) return false;
  if (pieces.length <= 1) return true;
  if (pieces.every(piece => piece.type === 'bishop')) {
    const bishopSquares = board.reduce<number[]>((squares, piece, index) => {
      if (piece?.type === 'bishop') squares.push((Math.floor(index / CHESS_SIZE) + index) % 2);
      return squares;
    }, []);
    return bishopSquares.every(square => square === bishopSquares[0]);
  }
  return false;
}

function findKing(board: ChessCell[], color: ChessColor): number {
  return board.findIndex(piece => piece?.color === color && piece.type === 'king');
}

function indexOf(row: number, column: number): number {
  return row >= 0 && row < CHESS_SIZE && column >= 0 && column < CHESS_SIZE ? row * CHESS_SIZE + column : -1;
}

function isOnBoard(row: number, column: number): boolean {
  return row >= 0 && row < CHESS_SIZE && column >= 0 && column < CHESS_SIZE;
}

function isOnBoardIndex(index: number): boolean {
  return index >= 0 && index < CHESS_BOARD_CELLS;
}

function otherColor(color: ChessColor): ChessColor {
  return color === 'white' ? 'black' : 'white';
}
