import React, { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Check,
  MousePointerClick,
  RotateCcw,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react';

import {
  BRAIN_GYM_MODES,
  createNumberMemory,
  createSequenceChallenge,
  formatBrainGymScore,
  getBrainGymBest,
  getBrainGymGrade,
  getReactionDelay,
  saveBrainGymBest,
  type BrainGymMode,
  type NumberMemoryChallenge,
} from './brainGymLogic';

type ReactionStatus = 'ready' | 'waiting' | 'active' | 'result';
type NumberStatus = 'ready' | 'showing' | 'input' | 'result';
type SequenceStatus = 'ready' | 'showing' | 'input' | 'result';
type BestScores = Record<BrainGymMode, number | null>;

interface BrainGymProps {
  onClose: () => void;
}

const GRID_SIZE = 3;

const initialBestScores = (): BestScores => ({
  reaction: getBrainGymBest('reaction'),
  'number-memory': getBrainGymBest('number-memory'),
  'sequence-memory': getBrainGymBest('sequence-memory'),
});

export default function BrainGym({ onClose }: BrainGymProps) {
  const [mode, setMode] = useState<BrainGymMode>('reaction');
  const [bestScores, setBestScores] = useState<BestScores>(initialBestScores);
  const timerRef = useRef<number | null>(null);

  const [reactionStatus, setReactionStatus] = useState<ReactionStatus>('ready');
  const [reactionStartedAt, setReactionStartedAt] = useState<number | null>(null);
  const [reactionScore, setReactionScore] = useState<number | null>(null);
  const [reactionMessage, setReactionMessage] = useState('点击开始，等屏幕变绿后马上点击。');

  const [numberStatus, setNumberStatus] = useState<NumberStatus>('ready');
  const [numberLevel, setNumberLevel] = useState(1);
  const [numberChallenge, setNumberChallenge] = useState<NumberMemoryChallenge | null>(null);
  const [numberAnswer, setNumberAnswer] = useState('');
  const [numberSuccess, setNumberSuccess] = useState(false);
  const [numberMessage, setNumberMessage] = useState('从 3 位数字开始，答对后会自动升级。');

  const [sequenceStatus, setSequenceStatus] = useState<SequenceStatus>('ready');
  const [sequence, setSequence] = useState<number[]>([]);
  const [sequenceLevel, setSequenceLevel] = useState(3);
  const [sequenceCursor, setSequenceCursor] = useState(0);
  const [sequenceFlash, setSequenceFlash] = useState<number | null>(null);
  const [sequenceSuccess, setSequenceSuccess] = useState(false);
  const [sequenceMessage, setSequenceMessage] = useState('从 3 格序列开始，按顺序复现亮起的方格。');

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const resetChallengeState = () => {
    clearTimer();
    setReactionStatus('ready');
    setReactionStartedAt(null);
    setReactionScore(null);
    setReactionMessage('点击开始，等屏幕变绿后马上点击。');
    setNumberStatus('ready');
    setNumberChallenge(null);
    setNumberAnswer('');
    setNumberSuccess(false);
    setNumberMessage('从 3 位数字开始，答对后会自动升级。');
    setSequenceStatus('ready');
    setSequence([]);
    setSequenceLevel(3);
    setSequenceCursor(0);
    setSequenceFlash(null);
    setSequenceSuccess(false);
    setSequenceMessage('从 3 格序列开始，按顺序复现亮起的方格。');
  };

  const selectMode = (nextMode: BrainGymMode) => {
    if (nextMode === mode) return;
    resetChallengeState();
    setMode(nextMode);
  };

  const recordBest = (scoreMode: BrainGymMode, score: number) => {
    saveBrainGymBest(scoreMode, score);
    setBestScores((current) => ({
      ...current,
      [scoreMode]: getBrainGymBest(scoreMode),
    }));
  };

  const startReaction = () => {
    clearTimer();
    setReactionStatus('waiting');
    setReactionStartedAt(null);
    setReactionScore(null);
    setReactionMessage('准备好……绿色出现前不要点击。');
    timerRef.current = window.setTimeout(() => {
      setReactionStatus('active');
      setReactionStartedAt(performance.now());
      setReactionMessage('就是现在，点击！');
    }, getReactionDelay());
  };

  const handleReactionClick = () => {
    if (reactionStatus === 'ready' || reactionStatus === 'result') {
      startReaction();
      return;
    }
    if (reactionStatus === 'waiting') {
      clearTimer();
      setReactionStatus('result');
      setReactionMessage('太早啦！提前点击不算成绩，再试一次。');
      return;
    }
    if (reactionStartedAt === null) return;
    const score = Math.max(1, Math.round(performance.now() - reactionStartedAt));
    setReactionStatus('result');
    setReactionScore(score);
    setReactionMessage(`${getBrainGymGrade('reaction', score)}，这次是 ${formatBrainGymScore('reaction', score)}。`);
    recordBest('reaction', score);
  };

  const startNumberRound = (targetLevel = numberLevel) => {
    clearTimer();
    const challenge = createNumberMemory(targetLevel);
    setNumberChallenge(challenge);
    setNumberAnswer('');
    setNumberSuccess(false);
    setNumberStatus('showing');
    setNumberMessage(`记住这 ${challenge.digits} 位数字，马上会消失。`);
    timerRef.current = window.setTimeout(() => {
      setNumberStatus('input');
      setNumberMessage('数字藏起来了，凭记忆输入并提交。');
    }, 1200);
  };

  const submitNumberAnswer = () => {
    if (numberStatus !== 'input' || !numberChallenge) return;
    const correct = numberAnswer.trim() === numberChallenge.value;
    setNumberStatus('result');
    setNumberSuccess(correct);
    if (correct) {
      const nextLevel = Math.min(numberChallenge.level + 1, 9);
      setNumberLevel(nextLevel);
      recordBest('number-memory', numberChallenge.digits);
      setNumberMessage(`答对了！${getBrainGymGrade('number-memory', numberChallenge.digits)}，下一关是 ${nextLevel + 2} 位数字。`);
    } else {
      setNumberLevel(1);
      setNumberMessage(`这次的答案是 ${numberChallenge.value}，从 3 位重新挑战。`);
    }
  };

  const revealSequence = (nextSequence: number[], index: number) => {
    setSequenceFlash(nextSequence[index]);
    timerRef.current = window.setTimeout(() => {
      if (index + 1 < nextSequence.length) {
        revealSequence(nextSequence, index + 1);
      } else {
        setSequenceFlash(null);
        setSequenceCursor(0);
        setSequenceStatus('input');
        setSequenceMessage('轮到你了，按刚才的顺序点击方格。');
      }
    }, 480);
  };

  const startSequenceRound = (targetLength = sequenceLevel) => {
    clearTimer();
    const nextSequence = createSequenceChallenge(targetLength, GRID_SIZE);
    setSequence(nextSequence);
    setSequenceCursor(0);
    setSequenceFlash(null);
    setSequenceSuccess(false);
    setSequenceStatus('showing');
    setSequenceMessage(`观察 ${nextSequence.length} 格亮起的顺序。`);
    revealSequence(nextSequence, 0);
  };

  const handleSequenceCell = (cell: number) => {
    if (sequenceStatus !== 'input' || sequence.length === 0) return;
    if (cell !== sequence[sequenceCursor]) {
      setSequenceStatus('result');
      setSequenceSuccess(false);
      setSequenceLevel(3);
      setSequenceMessage(`顺序错了！你完成了 ${sequenceCursor} 格，从 3 格重新挑战。`);
      return;
    }
    const nextCursor = sequenceCursor + 1;
    if (nextCursor === sequence.length) {
      const nextLevel = Math.min(sequence.length + 1, GRID_SIZE * GRID_SIZE);
      setSequenceStatus('result');
      setSequenceSuccess(true);
      setSequenceLevel(nextLevel);
      recordBest('sequence-memory', sequence.length);
      setSequenceMessage(`全部答对！${getBrainGymGrade('sequence-memory', sequence.length)}，下一组是 ${nextLevel} 格。`);
      return;
    }
    setSequenceCursor(nextCursor);
  };

  const activeMode = BRAIN_GYM_MODES.find((candidate) => candidate.id === mode) ?? BRAIN_GYM_MODES[0];
  const bestScore = bestScores[mode];

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-7">
      <section className="relative overflow-hidden rounded-[2.25rem] border border-[#d8b8dc] bg-[radial-gradient(circle_at_top_left,#fff0fb_0,#fffaf5_48%,#edf0ff_100%)] p-6 shadow-[0_24px_70px_rgba(112,69,129,0.12)] sm:p-9">
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full border border-white/80 bg-white/40" />
        <div className="relative">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-lg">
                <Brain className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-[#865181]">每日热身 · 趣味挑战</p>
              <h1 className="mt-3 font-serif text-4xl font-black leading-tight text-[#302238] sm:text-5xl">脑力挑战台</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[#6e5872]">反应、记忆和空间顺序三种玩法，随手来一局，不把结果当成严肃智力测验。</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d8e2ca] bg-[#f2f6ed] px-3 py-2 text-xs font-bold text-[#4d6036]"><Trophy className="h-4 w-4" aria-hidden="true" /> 记录本机最佳</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#decce1] bg-white/70 px-3 py-2 text-xs font-bold text-[#74517c]"><Sparkles className="h-4 w-4" aria-hidden="true" /> 成绩只保存在当前浏览器</span>
            </div>
          </div>

          <div className="mt-8 grid gap-2 sm:grid-cols-3" role="tablist" aria-label="脑力挑战类型">
            {BRAIN_GYM_MODES.map((candidate) => {
              const selected = candidate.id === mode;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="tab"
                  aria-label={candidate.label}
                  aria-selected={selected}
                  onClick={() => selectMode(candidate.id)}
                  className={`rounded-2xl border-2 px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b47ac0]/30 motion-reduce:transition-none ${selected ? 'border-[#9d5daa] bg-[#f6e8f7] text-[#66396e]' : 'border-[#ead9e9] bg-white/60 text-[#725d75] hover:border-[#c99ccc] hover:bg-white/80'}`}
                >
                  <span className="flex items-center gap-2 font-black">
                    {candidate.id === 'reaction' ? <MousePointerClick className="h-4 w-4" aria-hidden="true" /> : candidate.id === 'number-memory' ? <Zap className="h-4 w-4" aria-hidden="true" /> : <Brain className="h-4 w-4" aria-hidden="true" />}
                    {candidate.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 opacity-80">{candidate.description}</span>
                </button>
              );
            })}
          </div>

          <section className="mt-6 rounded-[1.75rem] border border-white/80 bg-white/70 p-5 shadow-sm sm:p-7" role="region" aria-label={activeMode.label}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#9a6c9f]">当前挑战</p>
                <h2 className="mt-1 font-serif text-2xl font-black text-[#302238]">{activeMode.label}</h2>
              </div>
              {bestScore !== null && (
                <div className="inline-flex items-center gap-2 self-start rounded-full bg-[#f2f6ed] px-3 py-2 text-sm font-black text-[#4d6036] sm:self-auto">
                  <Trophy className="h-4 w-4" aria-hidden="true" /> 本机最佳：{formatBrainGymScore(mode, bestScore)}
                </div>
              )}
            </div>

            {mode === 'reaction' && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={handleReactionClick}
                  className={`flex min-h-52 w-full items-center justify-center rounded-[1.5rem] border-4 text-center font-serif text-3xl font-black transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b47ac0]/35 motion-reduce:transition-none ${reactionStatus === 'active' ? 'border-[#8dbf85] bg-[#a9d99f] text-[#2f5d36] shadow-[0_0_55px_rgba(113,182,105,0.45)]' : reactionStatus === 'waiting' ? 'border-[#e5d5df] bg-[#f7eff5] text-[#805c80]' : 'border-[#dbc1df] bg-gradient-to-br from-[#f8eafb] to-[#eee9ff] text-[#66396e] hover:-translate-y-0.5 hover:shadow-lg'}`}
                  aria-label={reactionStatus === 'active' ? '现在点击' : reactionStatus === 'waiting' ? '等待绿色出现' : '开始反应测试'}
                >
                  {reactionStatus === 'active' ? '现在点击！' : reactionStatus === 'waiting' ? '等绿色出现…' : '开始反应测试'}
                </button>
                <p className="mt-4 text-center text-sm font-semibold leading-6 text-[#6e5872]">{reactionMessage}</p>
                {reactionScore !== null && (
                  <p className="mt-2 text-center font-serif text-4xl font-black text-[#66396e]">{formatBrainGymScore('reaction', reactionScore)}</p>
                )}
              </div>
            )}

            {mode === 'number-memory' && (
              <div className="mt-6">
                <div className="rounded-[1.5rem] border border-[#e4d6e6] bg-[#fcf8fd] px-4 py-8 text-center">
                  <p className="text-sm font-black text-[#865181]">第 {numberChallenge?.level ?? numberLevel} 关 · {numberChallenge?.digits ?? numberLevel + 2} 位数字</p>
                  <div data-testid="number-memory-value" className="mt-3 min-h-16 font-mono text-5xl font-black tracking-[0.18em] text-[#302238] sm:text-6xl">
                    {numberStatus === 'showing' && numberChallenge ? numberChallenge.value : numberChallenge ? '· · · · · · · · · ·' : '准备好了吗？'}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-[#6e5872]">{numberMessage}</p>
                </div>
                {numberStatus === 'input' && (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <label className="sr-only" htmlFor="brain-number-answer">输入刚才看到的数字</label>
                    <input
                      id="brain-number-answer"
                      aria-label="输入刚才看到的数字"
                      inputMode="numeric"
                      autoFocus
                      value={numberAnswer}
                      onChange={(event) => setNumberAnswer(event.target.value.replace(/\D/g, ''))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') submitNumberAnswer();
                      }}
                      className="min-w-0 flex-1 rounded-2xl border border-[#d8c1dc] bg-white px-4 py-3.5 text-center font-mono text-xl font-bold tracking-[0.15em] text-[#302238] outline-none focus:border-[#9d5daa] focus:ring-4 focus:ring-[#b47ac0]/20"
                    />
                    <button
                      type="button"
                      onClick={submitNumberAnswer}
                      disabled={!numberAnswer}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#784381] px-5 py-3.5 font-black text-white transition hover:bg-[#66396e] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b47ac0]/35 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Check className="h-5 w-5" aria-hidden="true" /> 提交答案
                    </button>
                  </div>
                )}
                {(numberStatus === 'ready' || numberStatus === 'result') && (
                  <button
                    type="button"
                    onClick={() => startNumberRound(numberSuccess ? numberLevel : 1)}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#784381] px-5 py-3.5 font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#66396e] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b47ac0]/35 motion-reduce:transform-none"
                  >
                    {numberStatus === 'result' && numberSuccess ? '下一关' : numberStatus === 'result' ? '再来一次' : '开始数字记忆'}
                    {numberStatus === 'result' ? <Zap className="h-5 w-5" aria-hidden="true" /> : <Sparkles className="h-5 w-5" aria-hidden="true" />}
                  </button>
                )}
              </div>
            )}

            {mode === 'sequence-memory' && (
              <div className="mt-6">
                <div className="rounded-[1.5rem] border border-[#e4d6e6] bg-[#fcf8fd] px-4 py-6 text-center">
                  <p className="text-sm font-black text-[#865181]">第 {sequenceLevel - 2} 关 · {sequence.length || sequenceLevel} 格序列</p>
                  <div className="mx-auto mt-4 grid max-w-xs grid-cols-3 gap-3" aria-label="方格序列面板">
                    {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, cell) => {
                      const lit = sequenceFlash === cell;
                      return (
                        <button
                          key={cell}
                          type="button"
                          aria-label={`第 ${cell + 1} 格`}
                          disabled={sequenceStatus !== 'input'}
                          onClick={() => handleSequenceCell(cell)}
                          className={`aspect-square rounded-2xl border-2 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b47ac0]/30 motion-reduce:transition-none ${lit ? 'border-[#9bc994] bg-[#a9d99f] shadow-[0_0_22px_rgba(113,182,105,0.5)]' : sequenceStatus === 'input' ? 'border-[#d8c1dc] bg-white hover:border-[#9d5daa] hover:bg-[#f6e8f7]' : 'border-[#ead9e9] bg-[#f3eaf5]'} disabled:cursor-default`}
                        />
                      );
                    })}
                  </div>
                  <p className="mt-4 text-sm font-semibold leading-6 text-[#6e5872]">{sequenceMessage}</p>
                  {sequenceStatus === 'input' && <p className="mt-1 text-xs font-bold text-[#9a6c9f]">已输入 {sequenceCursor} / {sequence.length}</p>}
                </div>
                {(sequenceStatus === 'ready' || sequenceStatus === 'result') && (
                  <button
                    type="button"
                    onClick={() => startSequenceRound(sequenceSuccess ? sequenceLevel : 3)}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#784381] px-5 py-3.5 font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#66396e] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b47ac0]/35"
                  >
                    {sequenceStatus === 'result' && sequenceSuccess ? '下一组' : sequenceStatus === 'result' ? '再来一次' : '开始方格序列'}
                    {sequenceStatus === 'result' ? <Zap className="h-5 w-5" aria-hidden="true" /> : <Sparkles className="h-5 w-5" aria-hidden="true" />}
                  </button>
                )}
              </div>
            )}
          </section>

          <div className="mt-5 flex flex-col gap-3 text-sm text-[#806b84] sm:flex-row sm:items-center sm:justify-between">
            <p className="inline-flex items-center gap-2"><Zap className="h-4 w-4 text-[#9a6c9f]" aria-hidden="true" /> {activeMode.hint}</p>
            <div className="flex gap-2">
              <button type="button" onClick={resetChallengeState} className="inline-flex items-center gap-1.5 rounded-xl border border-[#decce1] bg-white/65 px-3 py-2 font-bold text-[#74517c] transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b47ac0]/30">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> 重置本局
              </button>
              <button type="button" onClick={onClose} className="rounded-xl border border-[#decce1] bg-white/65 px-3 py-2 font-bold text-[#74517c] transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#b47ac0]/30">
                返回工具箱
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
