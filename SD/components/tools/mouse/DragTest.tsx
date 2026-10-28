import React, { useState, useRef, useCallback, useEffect } from 'react';

interface Point { x: number; y: number; }

const DragTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPath, setDragPath] = useState<Point[]>([]);
  const [deviation, setDeviation] = useState<number | null>(null);
  const [straightness, setStraightness] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<{ dev: number; straight: number }[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPointRef = useRef<Point | null>(null);
  const currentPathRef = useRef<Point[]>([]);

  const getRandomTarget = useCallback(() => {
    const container = containerRef.current;
    if (!container) return { x: 200, y: 200 };
    const rect = container.getBoundingClientRect();
    return {
      x: 50 + Math.random() * (rect.width - 100),
      y: 50 + Math.random() * (rect.height - 100),
    };
  }, []);

  const [target, setTarget] = useState<Point>({ x: 200, y: 100 });
  const [startPos, setStartPos] = useState<Point>({ x: 50, y: 200 });

  const resetRound = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Random start on left side, target on right side
    const newStart = { x: 30 + Math.random() * 40, y: 50 + Math.random() * (h - 100) };
    const newTarget = { x: w - 70 - Math.random() * 40, y: 50 + Math.random() * (h - 100) };

    setStartPos(newStart);
    setTarget(newTarget);
    setDragPath([]);
    setDeviation(null);
    setStraightness(null);
    currentPathRef.current = [];
  }, []);

  useEffect(() => {
    resetRound();
  }, [resetRound]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if clicking near start position
      const dist = Math.sqrt((x - startPos.x) ** 2 + (y - startPos.y) ** 2);
      if (dist < 30) {
        setIsDragging(true);
        currentPathRef.current = [{ x, y }];
        setDragPath([{ x, y }]);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      currentPathRef.current.push({ x, y });
      setDragPath([...currentPathRef.current]);
    };

    const handleMouseUp = () => {
      if (!isDragging) return;
      setIsDragging(false);

      const path = currentPathRef.current;
      if (path.length < 2) return;

      // Calculate deviation from straight line (start -> target)
      const lastPoint = path[path.length - 1];
      const endDist = Math.sqrt((lastPoint.x - target.x) ** 2 + (lastPoint.y - target.y) ** 2);
      setDeviation(Math.round(endDist * 10) / 10);

      // Calculate straightness (ratio of direct distance to path length)
      let pathLength = 0;
      for (let i = 1; i < path.length; i++) {
        pathLength += Math.sqrt((path[i].x - path[i - 1].x) ** 2 + (path[i].y - path[i - 1].y) ** 2);
      }
      const directDist = Math.sqrt((target.x - startPos.x) ** 2 + (target.y - startPos.y) ** 2);
      const straight = pathLength > 0 ? Math.round((directDist / pathLength) * 100) : 0;
      setStraightness(straight);

      setAttempts(prev => [{ dev: Math.round(endDist * 10) / 10, straight }, ...prev].slice(0, 10));
    };

    el.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      el.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, startPos, target]);

  const avgDev = attempts.length > 0 ? Math.round(attempts.reduce((a, b) => a + b.dev, 0) / attempts.length * 10) / 10 : 0;
  const avgStraight = attempts.length > 0 ? Math.round(attempts.reduce((a, b) => a + b.straight, 0) / attempts.length) : 0;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">从绿点拖拽到红点，测试拖拽精度</p>
      </div>

      {/* Drag area */}
      <div
        ref={containerRef}
        className="w-full h-48 rounded-xl border-2 border-lime-500/30 bg-slate-900/50 cursor-crosshair relative overflow-hidden select-none"
      >
        {/* Start point */}
        <div
          className="absolute w-5 h-5 rounded-full bg-lime-500 border-2 border-lime-400 -translate-x-1/2 -translate-y-1/2 z-10"
          style={{ left: startPos.x, top: startPos.y }}
        />
        {/* Target */}
        <div
          className="absolute w-5 h-5 rounded-full bg-red-500 border-2 border-red-400 -translate-x-1/2 -translate-y-1/2 z-10"
          style={{ left: target.x, top: target.y }}
        />
        {/* Guide line */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line x1={startPos.x} y1={startPos.y} x2={target.x} y2={target.y}
            stroke="rgba(100,116,139,0.2)" strokeWidth="1" strokeDasharray="4,4" />
        </svg>
        {/* Drag path */}
        {dragPath.length > 1 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <polyline
              points={dragPath.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="rgba(132,204,22,0.7)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {/* Result marker */}
        {deviation !== null && dragPath.length > 0 && (
          <div className="absolute text-xs text-lime-400 -translate-x-1/2 pointer-events-none"
            style={{ left: dragPath[dragPath.length - 1].x, top: dragPath[dragPath.length - 1].y + 10 }}>
            {deviation}px
          </div>
        )}
      </div>

      {/* Results */}
      {deviation !== null && straightness !== null && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500 mb-1">终点偏差</p>
            <p className={`text-xl font-bold ${deviation < 10 ? 'text-lime-400' : deviation < 30 ? 'text-amber-400' : 'text-red-400'}`}>
              {deviation}px
            </p>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-500 mb-1">直线度</p>
            <p className={`text-xl font-bold ${straightness > 90 ? 'text-lime-400' : straightness > 70 ? 'text-amber-400' : 'text-red-400'}`}>
              {straightness}%
            </p>
          </div>
        </div>
      )}

      <button onClick={resetRound} className="w-full px-4 py-2 bg-lime-500/20 border border-lime-500/30 text-lime-400 rounded-lg hover:bg-lime-500/30 transition-all text-sm">
        下一轮
      </button>

      {/* History */}
      {attempts.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-500">历史记录</p>
            <div className="flex gap-3 text-xs text-slate-500">
              <span>平均偏差: <span className="text-lime-400">{avgDev}px</span></span>
              <span>平均直线度: <span className="text-lime-400">{avgStraight}%</span></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {attempts.map((a, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-slate-700/50 text-slate-400 rounded-full">
                {a.dev}px / {a.straight}%
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DragTest;
