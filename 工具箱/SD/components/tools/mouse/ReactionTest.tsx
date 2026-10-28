import React, { useState, useRef, useCallback } from 'react';

type Phase = 'idle' | 'waiting' | 'ready' | 'result' | 'tooEarly';

const ReactionTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [reactionTime, setReactionTime] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const startTimeRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);

  const start = useCallback(() => {
    setPhase('waiting');
    const delay = 1000 + Math.random() * 4000;
    timeoutRef.current = window.setTimeout(() => {
      startTimeRef.current = performance.now();
      setPhase('ready');
    }, delay);
  }, []);

  const handleClick = useCallback(() => {
    if (phase === 'idle' || phase === 'result') {
      start();
      return;
    }
    if (phase === 'waiting') {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setPhase('tooEarly');
      return;
    }
    if (phase === 'ready') {
      const time = Math.round(performance.now() - startTimeRef.current);
      setReactionTime(time);
      setHistory(h => [time, ...h].slice(0, 10));
      setPhase('result');
    }
  }, [phase, start]);

  const getRating = (ms: number) => {
    if (ms < 200) return { text: '闪电反应', color: 'text-lime-400', bg: 'bg-lime-500/20' };
    if (ms < 250) return { text: '非常快', color: 'text-emerald-400', bg: 'bg-emerald-500/20' };
    if (ms < 300) return { text: '正常', color: 'text-blue-400', bg: 'bg-blue-500/20' };
    if (ms < 400) return { text: '偏慢', color: 'text-amber-400', bg: 'bg-amber-500/20' };
    return { text: '较慢', color: 'text-red-400', bg: 'bg-red-500/20' };
  };

  const best = history.length > 0 ? Math.min(...history) : 0;
  const avg = history.length > 0 ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : 0;

  const bgColors: Record<Phase, string> = {
    idle: 'bg-slate-800/50 border-slate-700',
    waiting: 'bg-red-500/20 border-red-500/30',
    ready: 'bg-lime-500/30 border-lime-500/50',
    result: 'bg-slate-800/50 border-slate-700',
    tooEarly: 'bg-amber-500/20 border-amber-500/30',
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">当屏幕变绿时，以最快速度点击</p>
      </div>

      <button
        onClick={handleClick}
        className={`w-full h-48 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-2 ${bgColors[phase]} cursor-pointer`}
      >
        {phase === 'idle' && (
          <span className="text-slate-300 text-lg font-medium">点击开始测试</span>
        )}
        {phase === 'waiting' && (
          <span className="text-red-400 text-lg font-medium">等待变绿...</span>
        )}
        {phase === 'ready' && (
          <span className="text-lime-400 text-2xl font-bold">点击!</span>
        )}
        {phase === 'tooEarly' && (
          <>
            <span className="text-amber-400 text-lg font-bold">太早了!</span>
            <span className="text-amber-400/60 text-sm">点击重新开始</span>
          </>
        )}
        {phase === 'result' && (
          <>
            <span className="text-4xl font-bold text-lime-400">{reactionTime} ms</span>
            <span className={`text-sm px-3 py-1 rounded-full ${getRating(reactionTime).bg} ${getRating(reactionTime).color} border border-current/20`}>
              {getRating(reactionTime).text}
            </span>
            <span className="text-xs text-slate-500 mt-1">点击重新测试</span>
          </>
        )}
      </button>

      {/* Stats */}
      {history.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500 mb-1">最佳</p>
            <p className="text-lg font-bold text-lime-400">{best} ms</p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500 mb-1">平均</p>
            <p className="text-lg font-bold text-slate-300">{avg} ms</p>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-2">最近 {history.length} 次</p>
          <div className="flex flex-wrap gap-1.5">
            {history.map((h, i) => (
              <span key={i} className={`text-xs px-2 py-1 rounded-full border ${
                h === best
                  ? 'bg-lime-500/20 text-lime-400 border-lime-500/30'
                  : 'bg-slate-700/50 text-slate-400 border-slate-600/50'
              }`}>
                {h}ms
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReactionTest;
