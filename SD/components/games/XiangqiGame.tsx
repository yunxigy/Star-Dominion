import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import {
  applyXiangqiMove,
  createXiangqiState,
  getXiangqiLegalMoves,
  isXiangqiInCheck,
  XIANGQI_BOARD_CELLS,
  type XiangqiColor,
  type XiangqiMove,
  type XiangqiPiece,
  type XiangqiPieceType,
  type XiangqiState,
} from '../../games/xiangqi';
import { chooseXiangqiMove, type XiangqiDifficulty } from '../../games/xiangqiAi';

type GameMode = 'ai' | 'local';

interface XiangqiSession {
  state: XiangqiState;
  history: XiangqiState[];
  mode: GameMode;
  aiSide: XiangqiColor;
  difficulty: XiangqiDifficulty;
}

const STORAGE_KEY = 'sd-game-xiangqi';
const PIECE_NAMES: Record<XiangqiColor, Record<XiangqiPieceType, string>> = {
  red: { general: '帅', advisor: '仕', elephant: '相', horse: '马', chariot: '车', cannon: '炮', soldier: '兵' },
  black: { general: '将', advisor: '士', elephant: '象', horse: '马', chariot: '车', cannon: '砲', soldier: '卒' },
};

function createSession(overrides: Partial<Pick<XiangqiSession, 'mode' | 'aiSide' | 'difficulty'>> = {}): XiangqiSession {
  return {
    state: createXiangqiState(),
    history: [],
    mode: overrides.mode ?? 'ai',
    aiSide: overrides.aiSide ?? 'black',
    difficulty: overrides.difficulty ?? 'normal',
  };
}

function readSession(): XiangqiSession {
  if (typeof window === 'undefined') return createSession();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSession();
    const parsed = JSON.parse(raw) as Partial<XiangqiSession>;
    if (!isValidSession(parsed)) return createSession();
    return { state: parsed.state!, history: parsed.history ?? [], mode: parsed.mode!, aiSide: parsed.aiSide!, difficulty: parsed.difficulty! };
  } catch {
    return createSession();
  }
}

function isValidSession(value: Partial<XiangqiSession>): value is XiangqiSession {
  const state = value.state;
  if (!state || !isValidState(state)) return false;
  return (value.mode === 'ai' || value.mode === 'local')
    && (value.aiSide === 'red' || value.aiSide === 'black')
    && (value.difficulty === 'easy' || value.difficulty === 'normal' || value.difficulty === 'hard')
    && (!value.history || (Array.isArray(value.history) && value.history.every(isValidState)));
}

function isValidState(value: XiangqiState): value is XiangqiState {
  return Array.isArray(value.board)
    && value.board.length === XIANGQI_BOARD_CELLS
    && value.board.every(cell => cell === null || isValidPiece(cell))
    && (value.currentPlayer === 'red' || value.currentPlayer === 'black')
    && (value.status === 'playing' || value.status === 'won' || value.status === 'checkmate' || value.status === 'stalemate')
    && (value.winner === null || value.winner === 'red' || value.winner === 'black')
    && (value.lastMove === null || isValidMove(value.lastMove));
}

function isValidPiece(value: XiangqiPiece): boolean {
  return (value.color === 'red' || value.color === 'black')
    && ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier'].includes(value.type);
}

function isValidMove(value: XiangqiMove): boolean {
  return Number.isInteger(value.from) && value.from >= 0 && value.from < XIANGQI_BOARD_CELLS
    && Number.isInteger(value.to) && value.to >= 0 && value.to < XIANGQI_BOARD_CELLS;
}

function saveSession(session: XiangqiSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage is optional.
  }
}

function playerName(player: XiangqiColor): string {
  return player === 'red' ? '红方' : '黑方';
}

function pieceLabel(piece: XiangqiPiece | null): string {
  return piece ? `${playerName(piece.color)}${PIECE_NAMES[piece.color][piece.type]}` : '空位';
}

export function XiangqiGame() {
  const [session, setSession] = useState<XiangqiSession>(() => readSession());
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const { state, mode, aiSide, difficulty } = session;
  const legalMoves = useMemo(() => getXiangqiLegalMoves(state), [state]);
  const selectedMoves = useMemo(() => selectedFrom === null ? [] : legalMoves.filter(move => move.from === selectedFrom), [legalMoves, selectedFrom]);
  const isAiTurn = mode === 'ai' && state.status === 'playing' && state.currentPlayer === aiSide;

  useEffect(() => saveSession(session), [session]);

  useEffect(() => {
    if (!isAiTurn) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setSession(previous => {
        if (previous.mode !== 'ai' || previous.state.status !== 'playing' || previous.state.currentPlayer !== previous.aiSide) return previous;
        const move = chooseXiangqiMove(previous.state, previous.difficulty);
        if (!move) return previous;
        try {
          return { ...previous, state: applyXiangqiMove(previous.state, move), history: [...previous.history, previous.state] };
        } catch {
          return previous;
        }
      });
    }, 320);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [aiSide, difficulty, isAiTurn]);

  const statusMessage = useMemo(() => {
    if ((state.status === 'won' || state.status === 'checkmate') && state.winner) return `${playerName(state.winner)}获胜`;
    if (state.status === 'stalemate') return `${playerName(state.winner ?? state.currentPlayer)}无棋可走，获胜`;
    if (isAiTurn) return `${playerName(state.currentPlayer)}思考中…`;
    if (isXiangqiInCheck(state, state.currentPlayer)) return `${playerName(state.currentPlayer)}被将军`;
    return `${playerName(state.currentPlayer)}回合`;
  }, [isAiTurn, state]);

  const reset = (overrides: Partial<Pick<XiangqiSession, 'mode' | 'aiSide' | 'difficulty'>> = {}) => {
    setSelectedFrom(null);
    setSession(previous => createSession({ mode: previous.mode, aiSide: previous.aiSide, difficulty: previous.difficulty, ...overrides }));
  };

  const commitMove = (move: XiangqiMove) => {
    try {
      setSession(previous => ({ ...previous, state: applyXiangqiMove(previous.state, move), history: [...previous.history, previous.state] }));
    } catch {
      // Keep the current board if a stale click races a state update.
    }
    setSelectedFrom(null);
  };

  const handleCellClick = (index: number) => {
    if (isAiTurn || state.status !== 'playing') return;
    const piece = state.board[index];
    if (selectedFrom === null) {
      if (piece?.color === state.currentPlayer && legalMoves.some(move => move.from === index)) setSelectedFrom(index);
      return;
    }
    const move = selectedMoves.find(candidate => candidate.to === index);
    if (move) commitMove(move);
    else if (piece?.color === state.currentPlayer && legalMoves.some(candidate => candidate.from === index)) setSelectedFrom(index);
    else setSelectedFrom(null);
  };

  const undo = () => {
    setSession(previous => {
      if (previous.history.length === 0) return previous;
      const steps = previous.mode === 'ai' ? Math.min(2, previous.history.length) : 1;
      return { ...previous, state: previous.history[previous.history.length - steps] ?? createXiangqiState(), history: previous.history.slice(0, -steps) };
    });
    setSelectedFrom(null);
  };

  return (
    <section className="game-panel" aria-labelledby="xiangqi-board-title">
      <div className="game-panel__board-card glass-card">
        <div className="game-panel__status-row game-panel__status-row--xiangqi">
          <div><p className="game-panel__eyebrow">当前状态</p><p id="xiangqi-board-title" className="game-panel__status" aria-live="polite">{statusMessage}</p></div>
          <span className={`game-panel__turn game-panel__turn--${state.currentPlayer}`} aria-label={`当前为${playerName(state.currentPlayer)}`}>{state.currentPlayer === 'red' ? '红' : '黑'}</span>
        </div>

        <div className="game-board game-board--xiangqi" role="grid" aria-label="中国象棋棋盘">
          {state.board.map((piece, index) => {
            const row = Math.floor(index / 9) + 1;
            const column = (index % 9) + 1;
            const selected = selectedFrom === index;
            const isLegalTarget = selectedMoves.some(move => move.to === index);
            const isLastMove = state.lastMove?.from === index || state.lastMove?.to === index;
            const river = row === 5 || row === 6;
            return (
              <button
                key={index}
                type="button"
                aria-label={`第${row}行第${column}列，${pieceLabel(piece)}`}
                disabled={isAiTurn || state.status !== 'playing'}
                onClick={() => handleCellClick(index)}
                className={`game-board__cell ${river ? 'game-board__cell--river' : ''} ${piece ? `game-board__cell--${piece.color}` : ''} ${selected ? 'game-board__cell--selected' : ''} ${isLegalTarget ? 'game-board__cell--legal' : ''} ${isLastMove ? 'game-board__cell--last-move' : ''}`}
              >
                {piece && <span className="game-board__xiangqi-piece" aria-hidden="true">{PIECE_NAMES[piece.color][piece.type]}</span>}
              </button>
            );
          })}
        </div>

        <div className="game-panel__actions">
          <button type="button" className="game-button game-button--primary" onClick={() => reset()}><RotateCcw className="h-4 w-4" aria-hidden="true" />新局</button>
          <button type="button" className="game-button" onClick={undo} disabled={session.history.length === 0 || isAiTurn}><Undo2 className="h-4 w-4" aria-hidden="true" />悔棋</button>
        </div>
      </div>

      <aside className="game-panel__settings glass-card" aria-label="游戏设置">
        <div><p className="game-panel__eyebrow">对战方式</p><div className="game-segmented" role="group" aria-label="对战方式"><button type="button" aria-pressed={mode === 'ai'} className={mode === 'ai' ? 'is-active' : ''} onClick={() => reset({ mode: 'ai' })}>人机对战</button><button type="button" aria-pressed={mode === 'local'} className={mode === 'local' ? 'is-active' : ''} onClick={() => reset({ mode: 'local' })}>双人同屏</button></div></div>
        {mode === 'ai' && <div className="game-panel__fields"><label className="game-field"><span>你的棋子</span><select value={aiSide === 'red' ? 'black' : 'red'} onChange={event => reset({ aiSide: event.target.value === 'red' ? 'black' : 'red' })}><option value="red">红方（先手）</option><option value="black">黑方（后手）</option></select></label><label className="game-field"><span>AI 难度</span><select value={difficulty} onChange={event => reset({ difficulty: event.target.value as XiangqiDifficulty })}><option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option></select></label></div>}
        <div className="game-panel__tips"><p className="game-panel__eyebrow">玩法提示</p><p>将军、困毙和楚河汉界均按中国象棋规则处理。</p><p>棋局只保存在当前浏览器，不会上传。</p></div>
      </aside>
    </section>
  );
}

export default XiangqiGame;
