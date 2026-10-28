import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import {
  applyConnectFourMove,
  createConnectFourState,
  CONNECT_FOUR_COLUMNS,
  CONNECT_FOUR_ROWS,
  type ConnectFourPlayer,
  type ConnectFourState,
} from '../../games/connectFour';
import { chooseConnectFourMove, type ConnectFourDifficulty } from '../../games/connectFourAi';

type GameMode = 'ai' | 'local';

interface ConnectFourSession {
  state: ConnectFourState;
  history: ConnectFourState[];
  mode: GameMode;
  aiSide: ConnectFourPlayer;
  difficulty: ConnectFourDifficulty;
}

const STORAGE_KEY = 'sd-game-connect-four';

function createSession(overrides: Partial<Pick<ConnectFourSession, 'mode' | 'aiSide' | 'difficulty'>> = {}): ConnectFourSession {
  return {
    state: createConnectFourState(),
    history: [],
    mode: overrides.mode ?? 'ai',
    aiSide: overrides.aiSide ?? 'yellow',
    difficulty: overrides.difficulty ?? 'normal',
  };
}

function readSession(): ConnectFourSession {
  if (typeof window === 'undefined') return createSession();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSession();
    const parsed = JSON.parse(raw) as Partial<ConnectFourSession>;
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

function isValidSession(value: Partial<ConnectFourSession>): value is ConnectFourSession {
  const state = value.state;
  if (!state || !isValidState(state)) return false;
  if (value.mode !== 'ai' && value.mode !== 'local') return false;
  if (value.aiSide !== 'red' && value.aiSide !== 'yellow') return false;
  if (value.difficulty !== 'easy' && value.difficulty !== 'normal' && value.difficulty !== 'hard') return false;
  return !value.history || (Array.isArray(value.history) && value.history.every(item => isValidState(item)));
}

function isValidState(value: ConnectFourState): boolean {
  return Boolean(value)
    && Array.isArray(value.board)
    && value.board.length === CONNECT_FOUR_ROWS * CONNECT_FOUR_COLUMNS
    && value.board.every(cell => cell === null || cell === 'red' || cell === 'yellow')
    && (value.currentPlayer === 'red' || value.currentPlayer === 'yellow')
    && (value.status === 'playing' || value.status === 'won' || value.status === 'draw')
    && (value.winner === null || value.winner === 'red' || value.winner === 'yellow')
    && Array.isArray(value.winningLine)
    && value.winningLine.every(index => Number.isInteger(index) && index >= 0 && index < CONNECT_FOUR_ROWS * CONNECT_FOUR_COLUMNS);
}

function saveSession(session: ConnectFourSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing or a full storage quota should not prevent the game from working.
  }
}

function playerName(player: ConnectFourPlayer): string {
  return player === 'red' ? '红方' : '黄方';
}

export function ConnectFourGame() {
  const [session, setSession] = useState<ConnectFourSession>(() => readSession());
  const { state, mode, aiSide, difficulty } = session;
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
        if (
          previous.mode !== 'ai'
          || previous.state.status !== 'playing'
          || previous.state.currentPlayer !== previous.aiSide
        ) {
          return previous;
        }
        const move = chooseConnectFourMove(previous.state, previous.difficulty);
        if (move === null) return previous;
        try {
          return {
            ...previous,
            state: applyConnectFourMove(previous.state, move),
            history: [...previous.history, previous.state],
          };
        } catch {
          return previous;
        }
      });
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiSide, difficulty, isAiTurn]);

  const statusMessage = useMemo(() => {
    if (state.status === 'won' && state.winner) return `${playerName(state.winner)}获胜`;
    if (state.status === 'draw') return '棋盘已满，平局';
    if (isAiTurn) return `${playerName(state.currentPlayer)}思考中…`;
    return `${playerName(state.currentPlayer)}回合`;
  }, [isAiTurn, state.currentPlayer, state.status, state.winner]);

  const reset = (overrides: Partial<Pick<ConnectFourSession, 'mode' | 'aiSide' | 'difficulty'>> = {}) => {
    setSession(previous => createSession({
      mode: previous.mode,
      aiSide: previous.aiSide,
      difficulty: previous.difficulty,
      ...overrides,
    }));
  };

  const handleMove = (column: number) => {
    if (isAiTurn || state.status !== 'playing') return;
    try {
      const next = applyConnectFourMove(state, column);
      setSession(previous => ({
        ...previous,
        state: next,
        history: [...previous.history, previous.state],
      }));
    } catch {
      // A full column can be clicked between renders; keep the UI stable in that case.
    }
  };

  const undo = () => {
    setSession(previous => {
      if (previous.history.length === 0) return previous;
      const steps = previous.mode === 'ai' ? Math.min(2, previous.history.length) : 1;
      const restored = previous.history[previous.history.length - steps] ?? createConnectFourState();
      return {
        ...previous,
        state: restored,
        history: previous.history.slice(0, -steps),
      };
    });
  };

  return (
    <section className="game-panel" aria-labelledby="connect-four-board-title">
      <div className="game-panel__board-card glass-card">
        <div className="game-panel__status-row game-panel__status-row--connect-four">
          <div>
            <p className="game-panel__eyebrow">当前状态</p>
            <p id="connect-four-board-title" className="game-panel__status" aria-live="polite">{statusMessage}</p>
          </div>
          <span className={`game-panel__turn game-panel__turn--${state.currentPlayer}`} aria-label={`当前为${playerName(state.currentPlayer)}`}>
            {state.currentPlayer === 'red' ? '红' : '黄'}
          </span>
        </div>

        <div className="game-board game-board--connect-four" role="grid" aria-label="四子棋棋盘">
          {state.board.map((cell, index) => {
            const row = Math.floor(index / CONNECT_FOUR_COLUMNS) + 1;
            const column = (index % CONNECT_FOUR_COLUMNS) + 1;
            const isWinningCell = state.winningLine.includes(index);
            const cellName = cell === 'red' ? '红方' : cell === 'yellow' ? '黄方' : '空位';
            return (
              <button
                key={index}
                type="button"
                aria-label={`第${row}行第${column}列，${cellName}`}
                disabled={cell !== null || isAiTurn || state.status !== 'playing'}
                onClick={() => handleMove(index % CONNECT_FOUR_COLUMNS)}
                className={`game-board__cell ${cell ? `game-board__cell--${cell}` : ''} ${isWinningCell ? 'game-board__cell--winning' : ''}`}
              >
                <span className="game-board__disc" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div className="game-panel__actions">
          <button type="button" className="game-button game-button--primary" onClick={() => reset()}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            新局
          </button>
          <button type="button" className="game-button" onClick={undo} disabled={session.history.length === 0 || isAiTurn}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            悔棋
          </button>
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
            <label className="game-field">
              <span>你的棋子</span>
              <select value={aiSide === 'red' ? 'yellow' : 'red'} onChange={event => reset({ aiSide: event.target.value === 'red' ? 'yellow' : 'red' })}>
                <option value="red">红方（先手）</option>
                <option value="yellow">黄方（后手）</option>
              </select>
            </label>
            <label className="game-field">
              <span>AI 难度</span>
              <select value={difficulty} onChange={event => reset({ difficulty: event.target.value as ConnectFourDifficulty })}>
                <option value="easy">简单</option>
                <option value="normal">普通</option>
                <option value="hard">困难</option>
              </select>
            </label>
          </div>
        )}

        <div className="game-panel__tips">
          <p className="game-panel__eyebrow">玩法提示</p>
          <p>横、竖或斜线连成四子即可获胜。</p>
          <p>棋局只保存在当前浏览器，不会上传。</p>
        </div>
      </aside>
    </section>
  );
}

export default ConnectFourGame;
