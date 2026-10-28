import React, { useState, useRef, useCallback } from 'react';

const DURATIONS = [5, 10, 15, 30] as const;

const CpsTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [duration, setDuration] = useState(5);
  const [clicks, setClicks] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [cps, setCps] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [cpsHistory, setCpsHistory] = useState<number[]>([]);
  const startTimeRef = useRef(0);
  const intervalRef = useRef<number | null>(null);

  const start = useCallback(() => {
    setClicks(0);
    setCps(0);
    setCpsHistory([]);
    startTimeRef.current = performance.now();
    setStatus('running');
    setTimeLeft(duration);

    intervalRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startTimeRef.current) / 1000;
      const remaining = Math.max(0, duration - elapsed);
      setTimeLeft(Math.ceil(remaining));
      if (remaining <= 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setStatus('done');
      }
    }, 100);
  }, [duration]);

  const handleClick = useCallback(() => {
    if (status !== 'running') return;
    const now = performance.now();
    const elapsed = (now - startTimeRef.current) / 1000;
    setClicks(prev => {
      const next = prev + 1;
      const currentCps = next / elapsed;
      setCps(Math.round(currentCps * 100) / 100);
      setCpsHistory(h => [...h, Math.round(currentCps * 100) / 100]);
      if (elapsed >= duration) {
        const finalCps = Math.round((next / duration) * 100) / 100;
        setCps(finalCps);
        setHistory(h => [finalCps, ...h].slice(0, 5));
        setStatus('done');
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
      return next;
    });
  }, [status, duration]);

  const maxCps = Math.max(...cpsHistory, 1);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">测试你的鼠标点击速度</p>
      </div>

      {/* Duration selector */}
      <div className="flex gap-2 justify-center">
        {DURATIONS.map(d => (
          <button
            key={d}
            onClick={() => { if (status === 'idle') setDuration(d); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              duration === d
                ? 'bg-lime-500/20 text-lime-400 border border-lime-500/30'
                : 'bg-slate-800/50 text-slate-400 border border-slate-700 hover:border-slate-600'
            } ${status !== 'idle' ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {d}秒
          </button>
        ))}
      </div>

      {/* Click area */}
      <button
        onClick={status === 'idle' ? start : handleClick}
        className={`w-full h-40 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-2 ${
          status === 'idle'
            ? 'bg-lime-500/10 border-lime-500/30 hover:bg-lime-500/20 cursor-pointer'
            : status === 'running'
            ? 'bg-lime-500/20 border-lime-500/50 active:scale-95 active:bg-lime-500/30 cursor-pointer'
            : 'bg-slate-800/50 border-slate-700 cursor-pointer hover:bg-slate-700/50'
        }`}
      >
        {status === 'idle' && (
          <span className="text-lime-400 text-lg font-medium">点击开始</span>
        )}
        {status === 'running' && (
          <>
            <span className="text-4xl font-bold text-lime-400">{clicks}</span>
            <span className="text-sm text-lime-400/60">{timeLeft}s 剩余</span>
          </>
        )}
        {status === 'done' && (
          <>
            <span className="text-3xl font-bold text-lime-400">{cps} CPS</span>
            <span className="text-sm text-slate-400">{clicks} 次点击 / {duration} 秒</span>
            <span className="text-xs text-slate-500">点击重新开始</span>
          </>
        )}
      </button>

      {/* CPS curve */}
      {cpsHistory.length > 1 && status === 'done' && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-2">CPS 变化曲线</p>
          <div className="h-20 flex items-end gap-px">
            {cpsHistory.filter((_, i) => i % Math.max(1, Math.floor(cpsHistory.length / 50)) === 0 || i === cpsHistory.length - 1).map((v, i, arr) => (
              <div
                key={i}
                className="flex-1 bg-lime-500/60 rounded-t-sm min-w-[2px]"
                style={{ height: `${(v / maxCps) * 100}%` }}
                title={`${v} CPS`}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-600 mt-1">
            <span>开始</span>
            <span>结束</span>
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-2">历史记录</p>
          <div className="flex gap-2 flex-wrap">
            {history.map((h, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-lime-500/10 text-lime-400 rounded-full border border-lime-500/20">
                {h} CPS
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CpsTest;
