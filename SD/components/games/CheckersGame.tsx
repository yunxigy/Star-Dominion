import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import {
  applyCheckersMove,
  CHECKERS_BOARD_CELLS,
  createCheckersState,
  getCheckersLegalMoves,
  type CheckersMove,
  type CheckersPiece,
  type CheckersPlayer,
  type CheckersState,
} from '../../games/checkers';
import { chooseCheckersMove, type CheckersDifficulty } from '../../games/checkersAi';

type GameMode = 'ai' | 'local';

interface CheckersSession {
  state: CheckersState;
  history: CheckersState[];
  mode: GameMode;
  aiSide: CheckersPlayer;
  difficulty: CheckersDifficulty;
}

const STORAGE_KEY = 'sd-game-checkers';

function createSession(overrides: Partial<Pick<CheckersSession, 'mode' | 'aiSide' | 'difficulty'>> = {}): CheckersSession {
  return {
    state: createCheckersState(),
    history: [],
    mode: overrides.mode ?? 'ai',
    aiSide: overrides.aiSide ?? 'red',
    difficulty: overrides.difficulty ?? 'normal',
  };
}

function readSession(): CheckersSession {
  if (typeof window === 'undefined') return createSession();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSession();
    const parsed = JSON.parse(raw) as Partial<CheckersSession>;
    if (!isValidSession(parsed)) return createSession();
    return { state: parsed.state!, history: parsed.history ?? [], mode: parsed.mode!, aiSide: parsed.aiSide!, difficulty: parsed.difficulty! };
  } catch {
    return createSession();
  }
}

function isValidSession(value: Partial<CheckersSession>): value is CheckersSession {
  const state = value.state;
  if (!state || !isValidState(state)) return false;
  return (value.mode === 'ai' || value.mode === 'local')
    && (value.aiSide === 'black' || value.aiSide === 'red')
    && (value.difficulty === 'easy' || value.difficulty === 'normal' || value.difficulty === 'hard')
    && (!value.history || (Array.isArray(value.history) && value.history.every(isValidState)));
}

function isValidState(value: CheckersState): value is CheckersState {
  return Array.isArray(value.board)
    && value.board.length === CHECKERS_BOARD_CELLS
    && value.board.every(cell => cell === null || isValidPiece(cell))
    && (value.currentPlayer === 'black' || value.currentPlayer === 'red')
    && (value.status === 'playing' || value.status === 'won' || value.status === 'draw')
    && (value.winner === null || value.winner === 'black' || value.winner === 'red')
    && (value.lastMove === null || isValidMove(value.lastMove));
}

function isValidPiece(value: CheckersPiece): boolean {
  return (value.player === 'black' || value.player === 'red') && typeof value.king === 'boolean';
}

function isValidMove(value: CheckersMove): boolean {
  return Array.isArray(value.path) && value.path.length >= 2
    && value.path.every(index => Number.isInteger(index) && index >= 0 && index < CHECKERS_BOARD_CELLS)
    && Array.isArray(value.captures)
    && value.captures.every(index => Number.isInteger(index) && index >= 0 && index < CHECKERS_BOARD_CELLS);
}

function saveSession(session: CheckersSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage is optional.
  }
}

function playerName(player: CheckersPlayer): string {
  return player === 'black' ? '黑方' : '红方';
}

function moveLabel(piece: CheckersPiece | null): string {
  if (!piece) return '空位';
  return `${playerName(piece.player)}${piece.king ? '王' : '兵'}`;
}

function isPlayable(index: number): boolean {
  return (Math.floor(index / 8) + index) % 2 === 1;
}

function matchesPrefix(move: CheckersMove, prefix: number[]): boolean {
  return prefix.length <= move.path.length && prefix.every((index, position) => move.path[position] === index);
}

export function CheckersGame() {
  const [session, setSession] = useState<CheckersSession>(() => readSession());
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null);
  const [selectedPath, setSelectedPath] = useState<number[]>([]);
  const { state, mode, aiSide, difficulty } = session;
  const legalMoves = useMemo(() => getCheckersLegalMoves(state), [state]);
  const selectedMoves = useMemo(() => selectedFrom === null ? [] : legalMoves.filter(move => move.path[0] === selectedFrom), [legalMoves, selectedFrom]);
  const prefix = selectedPath.length > 0 ? selectedPath : selectedFrom === null ? [] : [selectedFrom];
  const nextTargets = useMemo(() => {
    const targets = selectedMoves.filter(move => matchesPrefix(move, prefix)).map(move => move.path[prefix.length]).filter((target): target is number => target !== undefined);
    return [...new Set(targets)];
  }, [prefix, selectedMoves]);
  const isAiTurn = mode === 'ai' && state.status === 'playing' && state.currentPlayer === aiSide;

  useEffect(() => saveSession(session), [session]);

  useEffect(() => {
    if (!isAiTurn) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setSession(previous => {
        if (previous.mode !== 'ai' || previous.state.status !== 'playing' || previous.state.currentPlayer !== previous.aiSide) return previous;
        const move = chooseCheckersMove(previous.state, previous.difficulty);
        if (!move) return previous;
        try {
          return { ...previous, state: applyCheckersMove(previous.state, move), history: [...previous.history, previous.state] };
        } catch {
          return previous;
        }
      });
    }, 320);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [aiSide, difficulty, isAiTurn]);

  const statusMessage = useMemo(() => {
    if (state.status === 'won' && state.winner) return `${playerName(state.winner)}获胜`;
    if (state.status === 'draw') return '和棋';
    if (isAiTurn) return `${playerName(state.currentPlayer)}思考中…`;
    if (state.lastMove && state.lastMove.captures.length > 0) return `${playerName(state.currentPlayer)}回合 · 必须吃子`;
    return `${playerName(state.currentPlayer)}回合`;
  }, [isAiTurn, state]);

  const reset = (overrides: Partial<Pick<CheckersSession, 'mode' | 'aiSide' | 'difficulty'>> = {}) => {
    setSelectedFrom(null);
    setSelectedPath([]);
    setSession(previous => createSession({ mode: previous.mode, aiSide: previous.aiSide, difficulty: previous.difficulty, ...overrides }));
  };

  const commitMove = (move: CheckersMove) => {
    try {
      setSession(previous => ({ ...previous, state: applyCheckersMove(previous.state, move), history: [...previous.history, previous.state] }));
    } catch {
      // Keep the board stable if a stale click races a state update.
    }
    setSelectedFrom(null);
    setSelectedPath([]);
  };

  const handleCellClick = (index: number) => {
    if (isAiTurn || state.status !== 'playing' || !isPlayable(index)) return;
    const piece = state.board[index];
    if (selectedFrom === null) {
      if (piece?.player === state.currentPlayer && legalMoves.some(move => move.path[0] === index)) {
        setSelectedFrom(index);
        setSelectedPath([index]);
      }
      return;
    }
    const activePrefix = selectedPath.length > 0 ? selectedPath : [selectedFrom];
    if (nextTargets.includes(index)) {
      const completed = selectedMoves.find(move => matchesPrefix(move, [...activePrefix, index]) && move.path.length === activePrefix.length + 1);
      if (completed) commitMove(completed);
      else setSelectedPath([...activePrefix, index]);
      return;
    }
    if (activePrefix.length === 1 && piece?.player === state.currentPlayer && legalMoves.some(move => move.path[0] === index)) {
      setSelectedFrom(index);
      setSelectedPath([index]);
    } else {
      setSelectedFrom(null);
      setSelectedPath([]);
    }
  };

  const undo = () => {
    setSession(previous => {
      if (previous.history.length === 0) return previous;
      const steps = previous.mode === 'ai' ? Math.min(2, previous.history.length) : 1;
      return { ...previous, state: previous.history[previous.history.length - steps] ?? createCheckersState(), history: previous.history.slice(0, -steps) };
    });
    setSelectedFrom(null);
    setSelectedPath([]);
  };

  return (
    <section className="game-panel" aria-labelledby="checkers-board-title">
      <div className="game-panel__board-card glass-card">
        <div className="game-panel__status-row game-panel__status-row--checkers">
          <div><p className="game-panel__eyebrow">当前状态</p><p id="checkers-board-title" className="game-panel__status" aria-live="polite">{statusMessage}</p></div>
          <span className={`game-panel__turn game-panel__turn--${state.currentPlayer}`} aria-label={`当前为${playerName(state.currentPlayer)}`}>{state.currentPlayer === 'black' ? '黑' : '红'}</span>
        </div>

        <div className="game-board game-board--checkers" role="grid" aria-label="跳棋棋盘">
          {state.board.map((piece, index) => {
            const row = Math.floor(index / 8) + 1;
            const column = (index % 8) + 1;
            const selected = selectedPath.includes(index);
            const isTarget = nextTargets.includes(index);
            const tone = isPlayable(index) ? 'dark' : 'light';
            return (
              <button
                key={index}
                type="button"
                aria-label={`第${row}行第${column}列，${moveLabel(piece)}`}
                disabled={isAiTurn || state.status !== 'playing' || !isPlayable(index)}
                onClick={() => handleCellClick(index)}
                className={`game-board__cell game-board__cell--${tone} ${piece ? `game-board__cell--${piece.player}` : ''} ${piece?.king ? 'game-board__cell--king' : ''} ${selected ? 'game-board__cell--selected' : ''} ${isTarget ? 'game-board__cell--legal' : ''}`}
              >
                {piece && <span className="game-board__checkers-piece" aria-hidden="true">{piece.king ? '♛' : '●'}</span>}
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
        {mode === 'ai' && <div className="game-panel__fields"><label className="game-field"><span>你的棋子</span><select value={aiSide === 'black' ? 'red' : 'black'} onChange={event => reset({ aiSide: event.target.value === 'black' ? 'red' : 'black' })}><option value="black">黑方（先手）</option><option value="red">红方（后手）</option></select></label><label className="game-field"><span>AI 难度</span><select value={difficulty} onChange={event => reset({ difficulty: event.target.value as CheckersDifficulty })}><option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option></select></label></div>}
        <div className="game-panel__tips"><p className="game-panel__eyebrow">玩法提示</p><p>必须优先吃子，连续吃子会自动保留当前棋子继续选择。</p><p>棋局只保存在当前浏览器，不会上传。</p></div>
      </aside>
    </section>
  );
}

export default CheckersGame;
