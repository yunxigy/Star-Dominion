import React, { useRef, useEffect, useState, useCallback } from 'react';

const MouseTrail: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const pointsRef = useRef<{ x: number; y: number; time: number }[]>([]);
  const animFrameRef = useRef(0);

  const drawTrail = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const points = pointsRef.current;
    if (points.length < 2) return;

    // Draw trail with speed-based color
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dt = p1.time - p0.time;
      const speed = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;

      // Color mapping: slow=green, fast=red
      const hue = Math.max(0, 120 - speed * 2);
      const alpha = Math.max(0.1, 1 - (Date.now() - p1.time) / 3000);

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.strokeStyle = `hsla(${hue}, 80%, 50%, ${alpha})`;
      ctx.lineWidth = Math.max(1, 3 - speed * 0.01);
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Draw heat dots
    const gridSize = 20;
    const heatMap: Record<string, number> = {};
    points.forEach(p => {
      const key = `${Math.floor(p.x / gridSize)},${Math.floor(p.y / gridSize)}`;
      heatMap[key] = (heatMap[key] || 0) + 1;
    });

    const maxHeat = Math.max(...Object.values(heatMap), 1);
    Object.entries(heatMap).forEach(([key, count]) => {
      const [gx, gy] = key.split(',').map(Number);
      const intensity = count / maxHeat;
      if (intensity > 0.3) {
        ctx.fillStyle = `rgba(139, 92, 246, ${intensity * 0.3})`;
        ctx.fillRect(gx * gridSize, gy * gridSize, gridSize, gridSize);
      }
    });

    animFrameRef.current = requestAnimationFrame(drawTrail);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    resizeCanvas();

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawing) return;
      const rect = canvas.getBoundingClientRect();
      pointsRef.current.push({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        time: Date.now(),
      });
      // Keep last 500 points
      if (pointsRef.current.length > 500) {
        pointsRef.current = pointsRef.current.slice(-500);
      }
    };

    const handleMouseEnter = () => setIsDrawing(true);
    const handleMouseLeave = () => setIsDrawing(false);

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseenter', handleMouseEnter);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('resize', resizeCanvas);

    animFrameRef.current = requestAnimationFrame(drawTrail);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseenter', handleMouseEnter);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isDrawing, drawTrail]);

  const clear = useCallback(() => {
    pointsRef.current = [];
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">移动鼠标绘制轨迹，颜色代表速度</p>
      </div>

      <canvas
        ref={canvasRef}
        className="w-full h-64 rounded-xl border-2 border-lime-500/30 bg-slate-900/50 cursor-crosshair"
      />

      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-xs text-slate-400">慢速</span>
          <div className="flex-1 h-1 rounded-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500" />
          <span className="text-xs text-slate-400">快速</span>
          <div className="w-3 h-3 rounded-full bg-red-500" />
        </div>
        <button onClick={clear} className="px-4 py-2 bg-slate-800/50 border border-slate-700 text-slate-400 rounded-lg hover:bg-slate-700/30 transition-all text-sm">
          清除
        </button>
      </div>
    </div>
  );
};

export default MouseTrail;
