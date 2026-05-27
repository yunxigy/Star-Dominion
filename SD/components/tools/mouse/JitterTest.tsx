import React, { useState, useRef, useCallback, useEffect } from 'react';

type Phase = 'idle' | 'testing' | 'done';

const JitterTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [timeLeft, setTimeLeft] = useState(3);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [stats, setStats] = useState({ minX: 0, maxX: 0, minY: 0, maxY: 0, avgX: 0, avgY: 0, jitterX: 0, jitterY: 0 });
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<number | null>(null);

  const start = useCallback(() => {
    pointsRef.current = [];
    setPoints([]);
    setPhase('testing');
    setTimeLeft(3);

    intervalRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          // Calculate stats
          const pts = pointsRef.current;
          if (pts.length > 0) {
            const xs = pts.map(p => p.x);
            const ys = pts.map(p => p.y);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const avgX = xs.reduce((a, b) => a + b, 0) / xs.length;
            const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
            const jitterX = Math.round((maxX - minX) * 10) / 10;
            const jitterY = Math.round((maxY - minY) * 10) / 10;

            setStats({
              minX: Math.round(minX * 10) / 10,
              maxX: Math.round(maxX * 10) / 10,
              minY: Math.round(minY * 10) / 10,
              maxY: Math.round(maxY * 10) / 10,
              avgX: Math.round(avgX * 10) / 10,
              avgY: Math.round(avgY * 10) / 10,
              jitterX,
              jitterY,
            });
          }
          setPhase('done');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    if (phase !== 'testing') return;
    const el = containerRef.current;
    if (!el) return;

    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      pointsRef.current.push({ x, y });
      setPoints([...pointsRef.current]);
    };

    el.addEventListener('mousemove', handleMove);
    return () => el.removeEventListener('mousemove', handleMove);
  }, [phase]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const getJitterRating = (jitter: number) => {
    if (jitter < 1) return { text: '极稳', color: 'text-lime-400' };
    if (jitter < 2) return { text: '优秀', color: 'text-emerald-400' };
    if (jitter < 5) return { text: '正常', color: 'text-blue-400' };
    if (jitter < 10) return { text: '偏大', color: 'text-amber-400' };
    return { text: '抖动严重', color: 'text-red-400' };
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">保持鼠标静止3秒，检测抖动/漂移</p>
      </div>

      {phase === 'idle' && (
        <button onClick={start} className="w-full px-4 py-3 bg-lime-500/20 border border-lime-500/30 text-lime-400 rounded-lg hover:bg-lime-500/30 transition-all text-sm font-medium">
          开始测试
        </button>
      )}

      {/* Test area */}
      <div
        ref={containerRef}
        className={`w-full h-48 rounded-xl border-2 flex items-center justify-center transition-all ${
          phase === 'testing'
            ? 'bg-lime-500/10 border-lime-500/30 cursor-none'
            : 'bg-slate-800/30 border-slate-700'
        }`}
      >
        {phase === 'testing' && (
          <div className="text-center relative w-full h-full">
            {/* Crosshair */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="w-8 h-px bg-lime-500/50" />
              <div className="w-px h-8 bg-lime-500/50 absolute top-0 left-1/2 -translate-x-1/2" />
            </div>
            <span className="absolute top-3 left-1/2 -translate-x-1/2 text-lime-400 text-2xl font-bold">{timeLeft}</span>
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-lime-400/60 text-xs">保持鼠标静止</span>
            {/* Points visualization */}
            {points.length > 0 && (
              <svg className="absolute inset-0 w-full h-full">
                {points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={1} fill="rgba(132, 204, 22, 0.5)" />
                ))}
              </svg>
            )}
          </div>
        )}
        {phase === 'done' && (
          <div className="text-center">
            <p className="text-lime-400 text-lg font-bold">测试完成</p>
            <p className="text-sm text-slate-400">{points.length} 个采样点</p>
          </div>
        )}
      </div>

      {/* Results */}
      {phase === 'done' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">水平抖动</p>
              <p className={`text-xl font-bold ${getJitterRating(stats.jitterX).color}`}>{stats.jitterX}px</p>
              <p className="text-[10px] text-slate-600">{getJitterRating(stats.jitterX).text}</p>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
              <p className="text-xs text-slate-500 mb-1">垂直抖动</p>
              <p className={`text-xl font-bold ${getJitterRating(stats.jitterY).color}`}>{stats.jitterY}px</p>
              <p className="text-[10px] text-slate-600">{getJitterRating(stats.jitterY).text}</p>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-2">详细数据</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-slate-400">X范围: <span className="text-slate-300">{stats.minX} ~ {stats.maxX}</span></div>
              <div className="text-slate-400">Y范围: <span className="text-slate-300">{stats.minY} ~ {stats.maxY}</span></div>
              <div className="text-slate-400">X中心: <span className="text-slate-300">{stats.avgX}</span></div>
              <div className="text-slate-400">Y中心: <span className="text-slate-300">{stats.avgY}</span></div>
            </div>
          </div>

          <button onClick={start} className="w-full px-4 py-2 bg-lime-500/20 border border-lime-500/30 text-lime-400 rounded-lg hover:bg-lime-500/30 transition-all text-sm">
            重新测试
          </button>
        </>
      )}

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-3">
        <p className="text-xs text-slate-500">
          提示：抖动值越小越好。高质量传感器在光滑表面上抖动应小于2px。抖动大可能是因为表面不平或传感器老化。
        </p>
      </div>
    </div>
  );
};

export default JitterTest;
