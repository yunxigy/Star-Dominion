import React, { useState, useRef, useCallback } from 'react';

const DoubleClickTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [clicks, setClicks] = useState<{ time: number; isDouble: boolean }[]>([]);
  const [lastInterval, setLastInterval] = useState<number | null>(null);
  const [doubleClickCount, setDoubleClickCount] = useState(0);
  const [totalClicks, setTotalClicks] = useState(0);
  const lastClickRef = useRef(0);

  const handleClick = useCallback(() => {
    const now = performance.now();
    const interval = now - lastClickRef.current;
    setTotalClicks(prev => prev + 1);

    if (interval < 500 && lastClickRef.current > 0) {
      setLastInterval(Math.round(interval));
      setDoubleClickCount(prev => prev + 1);
      setClicks(prev => [{ time: Math.round(interval), isDouble: true }, ...prev].slice(0, 20));
    } else {
      setClicks(prev => [{ time: Math.round(interval), isDouble: false }, ...prev].slice(0, 20));
    }

    lastClickRef.current = now;
  }, []);

  const handleDoubleClick = useCallback(() => {
    // dblclick event fires separately
  }, []);

  const reset = useCallback(() => {
    setClicks([]);
    setLastInterval(null);
    setDoubleClickCount(0);
    setTotalClicks(0);
    lastClickRef.current = 0;
  }, []);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">测试鼠标双击功能和间隔时间</p>
      </div>

      <button
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className="w-full h-40 rounded-xl border-2 bg-lime-500/10 border-lime-500/30 hover:bg-lime-500/20 active:scale-95 transition-all flex flex-col items-center justify-center gap-2 cursor-pointer"
      >
        <span className="text-lime-400 text-lg font-medium">快速双击此处</span>
        {lastInterval !== null && (
          <span className="text-3xl font-bold text-lime-400">{lastInterval} ms</span>
        )}
        <span className="text-xs text-slate-500">已点击 {totalClicks} 次</span>
      </button>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-slate-500 mb-1">双击次数</p>
          <p className="text-lg font-bold text-lime-400">{doubleClickCount}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-slate-500 mb-1">总点击</p>
          <p className="text-lg font-bold text-slate-300">{totalClicks}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 text-center">
          <p className="text-[10px] text-slate-500 mb-1">双击率</p>
          <p className="text-lg font-bold text-slate-300">
            {totalClicks > 0 ? Math.round((doubleClickCount / Math.floor(totalClicks / 2)) * 100) : 0}%
          </p>
        </div>
      </div>

      {/* Click log */}
      {clicks.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">点击记录</p>
            <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">清除</button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {clicks.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded ${c.isDouble ? 'bg-lime-500/20 text-lime-400' : 'bg-slate-700/50 text-slate-500'}`}>
                  {c.isDouble ? '双击' : '单击'}
                </span>
                <span className="text-slate-400">{c.time}ms 间隔</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg p-3">
        <p className="text-xs text-slate-500">
          提示：Windows 默认双击间隔为 500ms。如果双击率低，可能需要在系统设置中调整双击速度。
        </p>
      </div>
    </div>
  );
};

export default DoubleClickTest;
