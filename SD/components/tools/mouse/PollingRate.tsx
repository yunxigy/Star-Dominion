import React, { useState, useRef, useCallback, useEffect } from 'react';

const PollingRate: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [isRunning, setIsRunning] = useState(false);
  const [hz, setHz] = useState(0);
  const [samples, setSamples] = useState(0);
  const [distribution, setDistribution] = useState<Record<number, number>>({});
  const [maxHz, setMaxHz] = useState(0);
  const intervalsRef = useRef<number[]>([]);
  const lastTimeRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const start = useCallback(() => {
    intervalsRef.current = [];
    lastTimeRef.current = 0;
    setHz(0);
    setSamples(0);
    setDistribution({});
    setMaxHz(0);
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const el = containerRef.current;
    if (!el) return;

    const handleMove = (e: MouseEvent) => {
      const now = performance.now();
      if (lastTimeRef.current > 0) {
        const interval = now - lastTimeRef.current;
        intervalsRef.current.push(interval);
        setSamples(intervalsRef.current.length);

        if (intervalsRef.current.length >= 10) {
          // Calculate average Hz from recent intervals
          const recent = intervalsRef.current.slice(-200);
          const avgInterval = recent.reduce((a, b) => a + b, 0) / recent.length;
          const calculatedHz = Math.round(1000 / avgInterval);

          // Round to nearest common polling rate
          const commonRates = [125, 250, 500, 1000, 2000, 4000, 8000];
          const nearest = commonRates.reduce((prev, curr) =>
            Math.abs(curr - calculatedHz) < Math.abs(prev - calculatedHz) ? curr : prev
          );

          setHz(calculatedHz);
          setMaxHz(prev => Math.max(prev, calculatedHz));

          // Build distribution
          const bucket = Math.round(interval / 0.1) * 0.1;
          setDistribution(prev => {
            const next = { ...prev };
            next[bucket] = (next[bucket] || 0) + 1;
            return next;
          });
        }
      }
      lastTimeRef.current = now;
    };

    el.addEventListener('mousemove', handleMove);
    return () => el.removeEventListener('mousemove', handleMove);
  }, [isRunning]);

  const commonRates = [125, 250, 500, 1000, 2000, 4000, 8000];
  const estimatedRate = hz > 0 ? commonRates.reduce((prev, curr) =>
    Math.abs(curr - hz) < Math.abs(prev - hz) ? curr : prev
  ) : 0;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">估算鼠标USB回报率（Hz）</p>
      </div>

      <div className="flex gap-2">
        {!isRunning ? (
          <button onClick={start} className="flex-1 px-4 py-2.5 bg-lime-500/20 border border-lime-500/30 text-lime-400 rounded-lg hover:bg-lime-500/30 transition-all text-sm font-medium">
            开始检测
          </button>
        ) : (
          <button onClick={stop} className="flex-1 px-4 py-2.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/30 transition-all text-sm font-medium">
            停止
          </button>
        )}
      </div>

      {/* Mouse move area */}
      <div
        ref={containerRef}
        className={`w-full h-32 rounded-xl border-2 flex items-center justify-center transition-all ${
          isRunning
            ? 'bg-lime-500/10 border-lime-500/30 cursor-crosshair'
            : 'bg-slate-800/30 border-slate-700'
        }`}
      >
        {isRunning ? (
          <div className="text-center">
            <span className="text-3xl font-bold text-lime-400">{hz}</span>
            <span className="text-lime-400/60 text-sm ml-1">Hz</span>
            <p className="text-xs text-slate-500 mt-1">快速移动鼠标以获得准确读数 ({samples} 采样)</p>
          </div>
        ) : (
          <span className="text-slate-500 text-sm">点击"开始检测"后快速移动鼠标</span>
        )}
      </div>

      {/* Result */}
      {hz > 0 && !isRunning && (
        <div className="bg-slate-800/50 border border-lime-500/20 rounded-lg p-4 text-center">
          <p className="text-xs text-slate-500 mb-1">估算回报率</p>
          <p className="text-4xl font-bold text-lime-400">{estimatedRate} Hz</p>
          <p className="text-xs text-slate-500 mt-1">实测平均: {hz} Hz (基于 {samples} 个采样)</p>
        </div>
      )}

      {/* Common rates */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
        <p className="text-xs text-slate-500 mb-2">常见回报率</p>
        <div className="grid grid-cols-4 gap-2">
          {commonRates.map(rate => (
            <div key={rate} className={`text-center p-2 rounded-lg border ${
              estimatedRate === rate
                ? 'bg-lime-500/20 border-lime-500/30 text-lime-400'
                : 'bg-slate-700/30 border-slate-700 text-slate-500'
            }`}>
              <span className="text-xs font-medium">{rate}Hz</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-3">
        <p className="text-xs text-slate-500">
          提示：回报率越高，鼠标移动越流畅。普通鼠标125Hz，游戏鼠标通常1000Hz，高端鼠标可达4000-8000Hz。
        </p>
      </div>
    </div>
  );
};

export default PollingRate;
