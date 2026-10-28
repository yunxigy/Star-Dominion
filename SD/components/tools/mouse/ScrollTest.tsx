import React, { useState, useRef, useCallback, useEffect } from 'react';

const ScrollTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [totalDelta, setTotalDelta] = useState(0);
  const [scrollEvents, setScrollEvents] = useState(0);
  const [lastDelta, setLastDelta] = useState(0);
  const [direction, setDirection] = useState<'up' | 'down' | 'none'>('none');
  const [maxSpeed, setMaxSpeed] = useState(0);
  const [history, setHistory] = useState<{ time: number; delta: number }[]>([]);
  const areaRef = useRef<HTMLDivElement>(null);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      const interval = now - lastTimeRef.current;
      lastTimeRef.current = now;

      const speed = interval > 0 ? Math.abs(e.deltaY) / interval * 1000 : 0;

      setTotalDelta(prev => prev + e.deltaY);
      setScrollEvents(prev => prev + 1);
      setLastDelta(e.deltaY);
      setDirection(e.deltaY > 0 ? 'down' : 'up');
      setMaxSpeed(prev => Math.max(prev, Math.round(speed)));
      setHistory(h => [{ time: Math.round(now), delta: e.deltaY }, ...h].slice(0, 100));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const reset = useCallback(() => {
    setTotalDelta(0);
    setScrollEvents(0);
    setLastDelta(0);
    setDirection('none');
    setMaxSpeed(0);
    setHistory([]);
    lastTimeRef.current = 0;
  }, []);

  const directionArrow = direction === 'down' ? '↓' : direction === 'up' ? '↑' : '·';

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">测试鼠标滚轮的灵敏度和方向</p>
      </div>

      {/* Scroll area */}
      <div
        ref={areaRef}
        className="w-full h-40 rounded-xl border-2 border-lime-500/30 bg-lime-500/10 flex flex-col items-center justify-center gap-2 cursor-pointer select-none"
      >
        <span className="text-4xl text-lime-400">{directionArrow}</span>
        <span className="text-sm text-lime-400/60">在此区域滚动滚轮</span>
        {lastDelta !== 0 && (
          <span className="text-xs text-slate-500">delta: {Math.round(lastDelta)}</span>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-500 mb-1">累计滚动量</p>
          <p className="text-lg font-bold text-lime-400">{Math.abs(Math.round(totalDelta))}</p>
          <p className="text-[10px] text-slate-600">{totalDelta > 0 ? '向下' : totalDelta < 0 ? '向上' : '中性'}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
          <p className="text-xs text-slate-500 mb-1">滚动事件数</p>
          <p className="text-lg font-bold text-slate-300">{scrollEvents}</p>
        </div>
      </div>

      {/* Scroll direction indicator */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div className="text-center">
            <p className="text-xs text-slate-500 mb-1">最大速度</p>
            <p className="text-sm font-bold text-lime-400">{maxSpeed} delta/s</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500 mb-1">当前方向</p>
            <p className="text-sm font-bold text-lime-400">{direction === 'down' ? '向下 ↓' : direction === 'up' ? '向上 ↑' : '停止'}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500 mb-1">最近delta</p>
            <p className="text-sm font-bold text-slate-300">{Math.round(lastDelta)}</p>
          </div>
        </div>
      </div>

      {/* History graph */}
      {history.length > 5 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-2">滚动波形</p>
          <div className="h-16 flex items-center">
            <div className="w-full h-px bg-slate-700 relative">
              {history.slice(0, 60).reverse().map((h, i) => {
                const maxDelta = Math.max(...history.map(x => Math.abs(x.delta)), 1);
                const height = Math.min((Math.abs(h.delta) / maxDelta) * 30, 30);
                return (
                  <div
                    key={i}
                    className={`absolute w-1 ${h.delta > 0 ? 'bg-lime-500/60' : 'bg-blue-500/60'}`}
                    style={{
                      left: `${(i / 60) * 100}%`,
                      height: `${height}px`,
                      bottom: h.delta > 0 ? '0' : 'auto',
                      top: h.delta <= 0 ? '0' : 'auto',
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      <button onClick={reset} className="w-full px-4 py-2 bg-slate-800/50 border border-slate-700 text-slate-400 rounded-lg hover:bg-slate-700/30 transition-all text-sm">
        重置
      </button>
    </div>
  );
};

export default ScrollTest;
