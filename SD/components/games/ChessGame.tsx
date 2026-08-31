import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import {
  applyChessMove,
  CHESS_BOARD_CELLS,
  createChessState,
  getChessLegalMoves,
  isChessInCheck,
  type ChessMove,
  type ChessPiece,
  type ChessPieceType,
  type ChessState,
  type ChessColor,
} from '../../games/chess';
import { chooseChessMove, type ChessDifficulty } from '../../games/chessAi';

type GameMode = 'ai' | 'local';
type PromotionPiece = Extract<ChessPieceType, 'queen' | 'rook' | 'bishop' | 'knight'>;

interface ChessSession {
  state: ChessState;
  history: ChessState[];
  mode: GameMode;
  aiSide: ChessColor;
  difficulty: ChessDifficulty;
}

interface PendingPromotion {
  from: number;
  to: number;
}

const STORAGE_KEY = 'sd-game-chess';
const PIECE_SYMBOLS: Record<ChessColor, Record<ChessPieceType, string>> = {
  white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
  black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
};
const PIECE_NAMES: Record<ChessPieceType, string> = {
  king: '王',
  queen: '后',
  rook: '车',
  bishop: '象',
  knight: '马',
  pawn: '兵',
};

function createSession(overrides: Partial<Pick<ChessSession, 'mode' | 'aiSide' | 'difficulty'>> = {}): ChessSession {
  return {
    state: createChessState(),
    history: [],
    mode: overrides.mode ?? 'ai',
    aiSide: overrides.aiSide ?? 'black',
    difficulty: overrides.difficulty ?? 'normal',
  };
}

function readSession(): ChessSession {
  if (typeof window === 'undefined') return createSession();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSession();
    const parsed = JSON.parse(raw) as Partial<ChessSession>;
    if (!isValidSession(parsed)) return createSession();
    return {
      state: parsed.state!,
      history: parsed.history ?? [],
      mode: parsed.mode!,
      aiSide: parsed.aiSide!,
      difficulty: parsed.difficulty!,
    };
  } catch {
    return createSession();
  }
}

function isValidSession(value: Partial<ChessSession>): value is ChessSession {
  const state = value.state;
  if (!state || !isValidState(state)) return false;
  return (value.mode === 'ai' || value.mode === 'local')
    && (value.aiSide === 'white' || value.aiSide === 'black')
    && (value.difficulty === 'easy' || value.difficulty === 'normal' || value.difficulty === 'hard')
    && (!value.history || (Array.isArray(value.history) && value.history.every(isValidState)));
}

function isValidState(value: ChessState): value is ChessState {
  return Array.isArray(value.board)
    && value.board.length === CHESS_BOARD_CELLS
    && value.board.every(cell => cell === null || isValidPiece(cell))
    && (value.currentPlayer === 'white' || value.currentPlayer === 'black')
    && (value.status === 'playing' || value.status === 'checkmate' || value.status === 'stalemate' || value.status === 'draw')
    && (value.winner === null || value.winner === 'white' || value.winner === 'black')
    && (value.lastMove === null || isValidMove(value.lastMove))
    && isValidCastlingRights(value.castlingRights)
    && (value.enPassantTarget === null || Number.isInteger(value.enPassantTarget) && value.enPassantTarget >= 0 && value.enPassantTarget < CHESS_BOARD_CELLS)
    && Number.isInteger(value.halfmoveClock) && value.halfmoveClock >= 0;
}

function isValidPiece(value: ChessPiece): boolean {
  return (value.color === 'white' || value.color === 'black')
    && ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'].includes(value.type);
}

function isValidMove(value: ChessMove): boolean {
  return Number.isInteger(value.from) && value.from >= 0 && value.from < CHESS_BOARD_CELLS
    && Number.isInteger(value.to) && value.to >= 0 && value.to < CHESS_BOARD_CELLS;
}

function isValidCastlingRights(value: ChessState['castlingRights']): boolean {
  return Boolean(value)
    && typeof value.whiteKingSide === 'boolean'
    && typeof value.whiteQueenSide === 'boolean'
    && typeof value.blackKingSide === 'boolean'
    && typeof value.blackQueenSide === 'boolean';
}

function saveSession(session: ChessSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage is optional; the in-memory game should continue in private browsing.
  }
}

function playerName(player: ChessColor): string {
  return player === 'white' ? '白方' : '黑方';
}

function moveLabel(piece: ChessPiece | null): string {
  return piece ? `${piece.color === 'white' ? '白方' : '黑方'}${PIECE_NAMES[piece.type]}` : '空位';
}

export function ChessGame() {
  const [session, setSession] = useState<ChessSession>(() => readSession());
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const { state, mode, aiSide, difficulty } = session;
  const legalMoves = useMemo(() => getChessLegalMoves(state), [state]);
  const selectedMoves = useMemo(() => selectedFrom === null ? [] : legalMoves.filter(move => move.from === selectedFrom), [legalMoves, selectedFrom]);
  const isAiTurn = mode === 'ai' && state.status === 'playing' && state.currentPlayer === aiSide;

  useEffect(() => {
    saveSession(session);
  }, [session]);

  useEffect(() => {
    if (!isAiTurn) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setSession(previous => {
        if (previous.mode !== 'ai' || previous.state.status !== 'playing' || previous.state.currentPlayer !== previous.aiSide) return previous;
        const move = chooseChessMove(previous.state, previous.difficulty);
        if (!move) return previous;
        try {
          return { ...previous, state: applyChessMove(previous.state, move), history: [...previous.history, previous.state] };
        } catch {
          return previous;
        }
      });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiSide, difficulty, isAiTurn]);

  const statusMessage = useMemo(() => {
    if (state.status === 'checkmate' && state.winner) return `${playerName(state.winner)}将死获胜`;
    if (state.status === 'stalemate') return '逼和，和棋';
    if (state.status === 'draw') return '和棋';
    if (isAiTurn) return `${playerName(state.currentPlayer)}思考中…`;
    if (isChessInCheck(state, state.currentPlayer)) return `${playerName(state.currentPlayer)}被将军`;
    return `${playerName(state.currentPlayer)}回合`;
  }, [isAiTurn, state]);

  const reset = (overrides: Partial<Pick<ChessSession, 'mode' | 'aiSide' | 'difficulty'>> = {}) => {
    setSelectedFrom(null);
    setPendingPromotion(null);
    setSession(previous => createSession({ mode: previous.mode, aiSide: previous.aiSide, difficulty: previous.difficulty, ...overrides }));
  };

  const commitMove = (move: ChessMove) => {
    try {
      setSession(previous => ({ ...previous, state: applyChessMove(previous.state, move), history: [...previous.history, previous.state] }));
      setSelectedFrom(null);
      setPendingPromotion(null);
    } catch {
      setSelectedFrom(null);
      setPendingPromotion(null);
    }
  };

  const handleCellClick = (index: number) => {
    if (isAiTurn || state.status !== 'playing' || pendingPromotion) return;
    const piece = state.board[index];
    if (selectedFrom === null) {
      if (piece?.color === state.currentPlayer && legalMoves.some(move => move.from === index)) setSelectedFrom(index);
      return;
    }
    const candidates = selectedMoves.filter(move => move.to === index);
    if (candidates.length > 1) {
      setPendingPromotion({ from: selectedFrom, to: index });
      return;
    }
    const move = candidates[0];
    if (move) {
      commitMove(move);
    } else if (piece?.color === state.currentPlayer && legalMoves.some(candidate => candidate.from === index)) {
      setSelectedFrom(index);
    } else {
      setSelectedFrom(null);
    }
  };

  const choosePromotion = (promotion: PromotionPiece) => {
    if (!pendingPromotion) return;
    const move = selectedMoves.find(candidate => candidate.to === pendingPromotion.to && candidate.promotion === promotion);
    if (move) commitMove(move);
  };

  const undo = () => {
    setSession(previous => {
      if (previous.history.length === 0) return previous;
      const steps = previous.mode === 'ai' ? Math.min(2, previous.history.length) : 1;
      return { ...previous, state: previous.history[previous.history.length - steps] ?? createChessState(), history: previous.history.slice(0, -steps) };
    });
    setSelectedFrom(null);
    setPendingPromotion(null);
  };

  return (
    <section className="game-panel" aria-labelledby="chess-board-title">
      <div className="game-panel__board-card glass-card">
        <div className="game-panel__status-row game-panel__status-row--chess">
          <div>
            <p className="game-panel__eyebrow">当前状态</p>
            <p id="chess-board-title" className="game-panel__status" aria-live="polite">{statusMessage}</p>
          </div>
          <span className={`game-panel__turn game-panel__turn--${state.currentPlayer}`} aria-label={`当前为${playerName(state.currentPlayer)}`}>{state.currentPlayer === 'white' ? '白' : '黑'}</span>
        </div>

        <div className="game-board game-board--chess" role="grid" aria-label="国际象棋棋盘">
          {state.board.map((piece, index) => {
            const row = Math.floor(index / 8) + 1;
            const column = (index % 8) + 1;
            const selected = selectedFrom === index;
            const isLegalTarget = selectedMoves.some(move => move.to === index);
            const isLastMove = state.lastMove?.from === index || state.lastMove?.to === index;
            const squareTone = (Math.floor(index / 8) + index) % 2 === 0 ? 'light' : 'dark';
            return (
              <button
                key={index}
                type="button"
                aria-label={`第${row}行第${column}列，${moveLabel(piece)}`}
                disabled={isAiTurn || state.status !== 'playing'}
                onClick={() => handleCellClick(index)}
                className={`game-board__cell game-board__cell--${squareTone} ${piece ? `game-board__cell--${piece.color}` : ''} ${selected ? 'game-board__cell--selected' : ''} ${isLegalTarget ? 'game-board__cell--legal' : ''} ${isLastMove ? 'game-board__cell--last-move' : ''}`}
              >
                {piece && <span className="game-board__chess-piece" aria-hidden="true">{PIECE_SYMBOLS[piece.color][piece.type]}</span>}
              </button>
            );
          })}
        </div>

        {pendingPromotion && (
          <div className="game-promotion" aria-label="选择升变棋子">
            <span>选择升变：</span>
            {(['queen', 'rook', 'bishop', 'knight'] as PromotionPiece[]).map(piece => (
              <button key={piece} type="button" className="game-button" onClick={() => choosePromotion(piece)}>{PIECE_NAMES[piece]}</button>
            ))}
          </div>
        )}

        <div className="game-panel__actions">
          <button type="button" className="game-button game-button--primary" onClick={() => reset()}><RotateCcw className="h-4 w-4" aria-hidden="true" />新局</button>
          <button type="button" className="game-button" onClick={undo} disabled={session.history.length === 0 || isAiTurn}><Undo2 className="h-4 w-4" aria-hidden="true" />悔棋</button>
        </div>
      </div>

      <aside className="game-panel__settings glass-card" aria-label="游戏设置">
        <div>
          <p className="game-panel__eyebrow">对战方式</p>
          <div className="game-segmented" role="group" aria-label="对战方式">
            <button type="button" aria-pressed={mode === 'ai'} className={mode === 'ai' ? 'is-active' : ''} onClick={() => reset({ mode: 'ai' })}>人机对战</button>
            <button type="button" aria-pressed={mode === 'local'} className={mode === 'local' ? 'is-active' : ''} onClick={() => reset({ mode: 'local' })}>双人同屏</button>
          </div>
        </div>
        {mode === 'ai' && (
          <div className="game-panel__fields">
            <label className="game-field"><span>你的棋子</span><select value={aiSide === 'white' ? 'black' : 'white'} onChange={event => reset({ aiSide: event.target.value === 'white' ? 'black' : 'white' })}><option value="white">白方（先手）</option><option value="black">黑方（后手）</option></select></label>
            <label className="game-field"><span>AI 难度</span><select value={difficulty} onChange={event => reset({ difficulty: event.target.value as ChessDifficulty })}><option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option></select></label>
          </div>
        )}
        <div className="game-panel__tips"><p className="game-panel__eyebrow">玩法提示</p><p>将死对方王即可获胜，支持王车易位、吃过路兵和兵升变。</p><p>棋局只保存在当前浏览器，不会上传。</p></div>
      </aside>
    </section>
  );
}

export default ChessGame;
