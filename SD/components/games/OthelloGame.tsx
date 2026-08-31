import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Undo2 } from 'lucide-react';
import {
  applyOthelloMove,
  createOthelloState,
  getOthelloLegalMoves,
  OTHELLO_SIZE,
  passOthelloTurn,
  type OthelloPlayer,
  type OthelloState,
} from '../../games/othello';
import { chooseOthelloMove, type OthelloDifficulty } from '../../games/othelloAi';

type GameMode = 'ai' | 'local';

interface OthelloSession {
  state: OthelloState;
  history: OthelloState[];
  mode: GameMode;
  aiSide: OthelloPlayer;
  difficulty: OthelloDifficulty;
}

const STORAGE_KEY = 'sd-game-othello';

function createSession(overrides: Partial<Pick<OthelloSession, 'mode' | 'aiSide' | 'difficulty'>> = {}): OthelloSession {
  return {
    state: createOthelloState(),
    history: [],
    mode: overrides.mode ?? 'ai',
    aiSide: overrides.aiSide ?? 'white',
    difficulty: overrides.difficulty ?? 'normal',
  };
}

function readSession(): OthelloSession {
  if (typeof window === 'undefined') return createSession();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSession();
    const parsed = JSON.parse(raw) as Partial<OthelloSession>;
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

function isValidSession(value: Partial<OthelloSession>): value is OthelloSession {
  const state = value.state;
  if (!state || !isValidState(state)) return false;
  if (value.mode !== 'ai' && value.mode !== 'local') return false;
  if (value.aiSide !== 'black' && value.aiSide !== 'white') return false;
  if (value.difficulty !== 'easy' && value.difficulty !== 'normal' && value.difficulty !== 'hard') return false;
  return !value.history || (Array.isArray(value.history) && value.history.every(item => isValidState(item)));
}

function isValidState(value: OthelloState): boolean {
  return Boolean(value)
    && Array.isArray(value.board)
    && value.board.length === OTHELLO_SIZE * OTHELLO_SIZE
    && value.board.every(cell => cell === null || cell === 'black' || cell === 'white')
    && (value.currentPlayer === 'black' || value.currentPlayer === 'white')
    && (value.status === 'playing' || value.status === 'won' || value.status === 'draw')
    && (value.winner === null || value.winner === 'black' || value.winner === 'white')
    && (value.lastMove === null || (Number.isInteger(value.lastMove) && value.lastMove >= 0 && value.lastMove < OTHELLO_SIZE * OTHELLO_SIZE))
    && (value.lastPass === null || value.lastPass === 'black' || value.lastPass === 'white');
}

function saveSession(session: OthelloSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing or a full storage quota should not prevent the game from working.
  }
}

function playerName(player: OthelloPlayer): string {
  return player === 'black' ? '黑方' : '白方';
}

export function OthelloGame() {
  const [session, setSession] = useState<OthelloSession>(() => readSession());
  const { state, mode, aiSide, difficulty } = session;
  const legalMoves = useMemo(() => getOthelloLegalMoves(state), [state]);
  const hasNoMoves = state.status === 'playing' && legalMoves.length === 0;
  const isAiTurn = mode === 'ai' && state.status === 'playing' && state.currentPlayer === aiSide && !hasNoMoves;

  useEffect(() => {
    saveSession(session);
  }, [session]);

  useEffect(() => {
    if (!hasNoMoves) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setSession(previous => {
        if (previous.state.status !== 'playing' || getOthelloLegalMoves(previous.state).length > 0) return previous;
        try {
          return {
            ...previous,
            state: passOthelloTurn(previous.state),
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
  }, [hasNoMoves, state]);

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
        const move = chooseOthelloMove(previous.state, previous.difficulty);
        if (move === null) return previous;
        try {
          return {
            ...previous,
            state: applyOthelloMove(previous.state, move),
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
  }, [aiSide, difficulty, isAiTurn, state]);

  const statusMessage = useMemo(() => {
    if (state.status === 'won' && state.winner) return `${playerName(state.winner)}获胜`;
    if (state.status === 'draw') return '双方棋子相同，平局';
    if (hasNoMoves) return `${playerName(state.currentPlayer)}无棋可下，自动跳过…`;
    if (state.lastPass && state.lastPass !== state.currentPlayer) return `${playerName(state.lastPass)}无棋可下，${playerName(state.currentPlayer)}继续`;
    if (isAiTurn) return `${playerName(state.currentPlayer)}思考中…`;
    return `${playerName(state.currentPlayer)}回合`;
  }, [hasNoMoves, isAiTurn, state.currentPlayer, state.lastPass, state.status, state.winner]);

  const reset = (overrides: Partial<Pick<OthelloSession, 'mode' | 'aiSide' | 'difficulty'>> = {}) => {
    setSession(previous => createSession({
      mode: previous.mode,
      aiSide: previous.aiSide,
      difficulty: previous.difficulty,
      ...overrides,
    }));
  };

  const handleMove = (index: number) => {
    if (isAiTurn || hasNoMoves || state.status !== 'playing') return;
    try {
      const next = applyOthelloMove(state, index);
      setSession(previous => ({
        ...previous,
        state: next,
        history: [...previous.history, previous.state],
      }));
    } catch {
      // Only legal empty cells are enabled; keep the UI stable if a stale click slips through.
    }
  };

  const undo = () => {
    setSession(previous => {
      if (previous.history.length === 0) return previous;
      const steps = previous.mode === 'ai' ? Math.min(2, previous.history.length) : 1;
      const restored = previous.history[previous.history.length - steps] ?? createOthelloState();
      return {
        ...previous,
        state: restored,
        history: previous.history.slice(0, -steps),
      };
    });
  };

  return (
    <section className="game-panel" aria-labelledby="othello-board-title">
      <div className="game-panel__board-card glass-card">
        <div className="game-panel__status-row game-panel__status-row--othello">
          <div>
            <p className="game-panel__eyebrow">当前状态</p>
            <p id="othello-board-title" className="game-panel__status" aria-live="polite">{statusMessage}</p>
          </div>
          <span className={`game-panel__turn game-panel__turn--${state.currentPlayer}`} aria-label={`当前为${playerName(state.currentPlayer)}`}>
            {state.currentPlayer === 'black' ? '黑' : '白'}
          </span>
        </div>

        <div className="game-board game-board--othello" role="grid" aria-label="黑白棋棋盘">
          {state.board.map((cell, index) => {
            const row = Math.floor(index / OTHELLO_SIZE) + 1;
            const column = (index % OTHELLO_SIZE) + 1;
            const isLegal = legalMoves.includes(index);
            const isLastMove = state.lastMove === index;
            const cellName = cell === 'black' ? '黑方' : cell === 'white' ? '白方' : '空位';
            return (
              <button
                key={index}
                type="button"
                aria-label={`第${row}行第${column}列，${cellName}`}
                disabled={cell !== null || !isLegal || isAiTurn || state.status !== 'playing'}
                onClick={() => handleMove(index)}
                className={`game-board__cell ${cell ? `game-board__cell--${cell}` : ''} ${isLastMove ? 'game-board__cell--last-move' : ''}`}
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
              <select value={aiSide === 'black' ? 'white' : 'black'} onChange={event => reset({ aiSide: event.target.value === 'black' ? 'white' : 'black' })}>
                <option value="black">黑方（先手）</option>
                <option value="white">白方（后手）</option>
              </select>
            </label>
            <label className="game-field">
              <span>AI 难度</span>
              <select value={difficulty} onChange={event => reset({ difficulty: event.target.value as OthelloDifficulty })}>
                <option value="easy">简单</option>
                <option value="normal">普通</option>
                <option value="hard">困难</option>
              </select>
            </label>
          </div>
        )}

        <div className="game-panel__tips">
          <p className="game-panel__eyebrow">玩法提示</p>
          <p>夹住对手棋子即可翻转，结束时棋子更多的一方获胜。</p>
          <p>棋局只保存在当前浏览器，不会上传。</p>
        </div>
      </aside>
    </section>
  );
}

export default OthelloGame;
