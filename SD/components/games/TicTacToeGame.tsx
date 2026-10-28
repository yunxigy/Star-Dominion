import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import {
  applyTicTacToeMove,
  createTicTacToeState,
  type TicTacToePlayer,
  type TicTacToeState,
} from '../../games/ticTacToe';
import { chooseTicTacToeMove, type TicTacToeDifficulty } from '../../games/ticTacToeAi';

type GameMode = 'ai' | 'local';

interface TicTacToeSession {
  state: TicTacToeState;
  history: TicTacToeState[];
  mode: GameMode;
  aiSide: TicTacToePlayer;
  difficulty: TicTacToeDifficulty;
}

const STORAGE_KEY = 'sd-game-tic-tac-toe';

function createSession(overrides: Partial<Pick<TicTacToeSession, 'mode' | 'aiSide' | 'difficulty'>> = {}): TicTacToeSession {
  return {
    state: createTicTacToeState(),
    history: [],
    mode: overrides.mode ?? 'ai',
    aiSide: overrides.aiSide ?? 'O',
    difficulty: overrides.difficulty ?? 'normal',
  };
}

function readSession(): TicTacToeSession {
  if (typeof window === 'undefined') return createSession();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSession();
    const parsed = JSON.parse(raw) as Partial<TicTacToeSession>;
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

function isValidSession(value: Partial<TicTacToeSession>): value is TicTacToeSession {
  const state = value.state;
  if (!state || !Array.isArray(state.board) || state.board.length !== 9) return false;
  if (!state.board.every(cell => cell === null || cell === 'X' || cell === 'O')) return false;
  if (state.currentPlayer !== 'X' && state.currentPlayer !== 'O') return false;
  if (state.status !== 'playing' && state.status !== 'won' && state.status !== 'draw') return false;
  if (state.winner !== null && state.winner !== 'X' && state.winner !== 'O') return false;
  if (!Array.isArray(state.winningLine) || !state.winningLine.every(index => Number.isInteger(index) && index >= 0 && index < 9)) return false;
  if (value.mode !== 'ai' && value.mode !== 'local') return false;
  if (value.aiSide !== 'X' && value.aiSide !== 'O') return false;
  if (value.difficulty !== 'easy' && value.difficulty !== 'normal' && value.difficulty !== 'hard') return false;
  return !value.history || (Array.isArray(value.history) && value.history.every(item => isValidState(item)));
}

function isValidState(value: TicTacToeState): boolean {
  return Boolean(value)
    && Array.isArray(value.board)
    && value.board.length === 9
    && value.board.every(cell => cell === null || cell === 'X' || cell === 'O')
    && (value.currentPlayer === 'X' || value.currentPlayer === 'O')
    && (value.status === 'playing' || value.status === 'won' || value.status === 'draw')
    && (value.winner === null || value.winner === 'X' || value.winner === 'O')
    && Array.isArray(value.winningLine);
}

function saveSession(session: TicTacToeSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing or a full storage quota should not prevent the game from working.
  }
}

export function TicTacToeGame() {
  const [session, setSession] = useState<TicTacToeSession>(() => readSession());
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
        const move = chooseTicTacToeMove(previous.state, previous.difficulty);
        if (move === null) return previous;
        try {
          return {
            ...previous,
            state: applyTicTacToeMove(previous.state, move),
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
    if (state.status === 'won') return `${state.winner} 方获胜`;
    if (state.status === 'draw') return '平局，再来一局吧';
    if (isAiTurn) return `${state.currentPlayer} 方思考中…`;
    return `${state.currentPlayer} 方回合`;
  }, [isAiTurn, state.currentPlayer, state.status, state.winner]);

  const reset = (overrides: Partial<Pick<TicTacToeSession, 'mode' | 'aiSide' | 'difficulty'>> = {}) => {
    setSession(previous => createSession({
      mode: previous.mode,
      aiSide: previous.aiSide,
      difficulty: previous.difficulty,
      ...overrides,
    }));
  };

  const handleMove = (index: number) => {
    if (isAiTurn || state.status !== 'playing') return;
    try {
      const next = applyTicTacToeMove(state, index);
      setSession(previous => ({
        ...previous,
        state: next,
        history: [...previous.history, previous.state],
      }));
    } catch {
      // Disabled cells should be the only path to an invalid move; keep the UI stable if called otherwise.
    }
  };

  const undo = () => {
    setSession(previous => {
      if (previous.history.length === 0) return previous;
      const steps = previous.mode === 'ai' ? Math.min(2, previous.history.length) : 1;
      const restored = previous.history[previous.history.length - steps] ?? createTicTacToeState();
      return {
        ...previous,
        state: restored,
        history: previous.history.slice(0, -steps),
      };
    });
  };

  return (
    <section className="game-panel" aria-labelledby="tic-tac-toe-board-title">
      <div className="game-panel__board-card glass-card">
        <div className="game-panel__status-row">
          <div>
            <p className="game-panel__eyebrow">当前状态</p>
            <p id="tic-tac-toe-board-title" className="game-panel__status" aria-live="polite">{statusMessage}</p>
          </div>
          <span className={`game-panel__turn game-panel__turn--${state.currentPlayer.toLowerCase()}`} aria-label={`当前为${state.currentPlayer}方`}>
            {state.currentPlayer}
          </span>
        </div>

        <div className="game-board game-board--tic-tac-toe" role="grid" aria-label="井字棋棋盘">
          {state.board.map((cell, index) => {
            const row = Math.floor(index / 3) + 1;
            const column = (index % 3) + 1;
            const isWinningCell = state.winningLine.includes(index);
            return (
              <button
                key={index}
                type="button"
                aria-label={`第${row}行第${column}列，${cell ?? '空位'}`}
                disabled={cell !== null || isAiTurn || state.status !== 'playing'}
                onClick={() => handleMove(index)}
                className={`game-board__cell ${cell ? `game-board__cell--${cell.toLowerCase()}` : ''} ${isWinningCell ? 'game-board__cell--winning' : ''}`}
              >
                {cell}
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
              <select value={aiSide === 'X' ? 'O' : 'X'} onChange={event => reset({ aiSide: event.target.value === 'X' ? 'O' : 'X' })}>
                <option value="X">X（先手）</option>
                <option value="O">O（后手）</option>
              </select>
            </label>
            <label className="game-field">
              <span>AI 难度</span>
              <select value={difficulty} onChange={event => reset({ difficulty: event.target.value as TicTacToeDifficulty })}>
                <option value="easy">简单</option>
                <option value="normal">普通</option>
                <option value="hard">困难</option>
              </select>
            </label>
          </div>
        )}

        <div className="game-panel__tips">
          <p className="game-panel__eyebrow">玩法提示</p>
          <p>横、竖、斜线连成三子即可获胜。</p>
          <p>棋局只保存在当前浏览器，不会上传。</p>
        </div>
      </aside>
    </section>
  );
}

export default TicTacToeGame;
