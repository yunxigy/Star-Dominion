import React, { useState, useRef, useCallback, useEffect } from 'react';

type Stage = 'idle' | 'measuring' | 'done';

const DpiAnalyzer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [stage, setStage] = useState<Stage>('idle');
  const [physicalDist, setPhysicalDist] = useState('10');
  const [pixelDist, setPixelDist] = useState(0);
  const [dpi, setDpi] = useState(0);
  const startXRef = useRef(0);
  const measuringRef = useRef(false);

  const handleAreaMouseDown = useCallback((e: React.MouseEvent) => {
    if (stage !== 'measuring') return;
    startXRef.current = e.clientX;
    measuringRef.current = true;
  }, [stage]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!measuringRef.current) return;
      const dx = e.clientX - startXRef.current;
      setPixelDist(Math.abs(dx));
    };

    const handleMouseUp = () => {
      if (!measuringRef.current) return;
      measuringRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startMeasure = useCallback(() => {
    setPixelDist(0);
    setDpi(0);
    setStage('measuring');
  }, []);

  const calculateDpi = useCallback(() => {
    const distMm = parseFloat(physicalDist);
    if (isNaN(distMm) || distMm <= 0 || pixelDist === 0) return;
    const distInch = distMm / 25.4;
    const calculatedDpi = Math.round(pixelDist / distInch);
    setDpi(calculatedDpi);
    setStage('done');
  }, [physicalDist, pixelDist]);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-slate-400 text-sm">测量鼠标实际DPI值</p>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <p className="text-xs text-slate-500 mb-2">操作步骤</p>
        <ol className="text-sm text-slate-300 space-y-1 list-decimal list-inside">
          <li>输入你将要移动鼠标的物理距离（毫米）</li>
          <li>点击"开始测量"，在下方区域按住鼠标拖拽</li>
          <li>松开后点击"计算DPI"</li>
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400">移动距离：</label>
        <input
          type="number"
          value={physicalDist}
          onChange={e => setPhysicalDist(e.target.value)}
          className="w-24 bg-slate-800/50 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-lime-500/50 text-center"
          min="1"
        />
        <span className="text-sm text-slate-500">mm</span>
      </div>

      {/* Measuring area */}
      <div
        onMouseDown={handleAreaMouseDown}
        className={`w-full h-32 rounded-xl border-2 flex items-center justify-center transition-all ${
          stage === 'measuring'
            ? 'bg-lime-500/10 border-lime-500/30 cursor-crosshair'
            : 'bg-slate-800/30 border-slate-700 cursor-default'
        }`}
      >
        {stage === 'idle' && <span className="text-slate-500 text-sm">点击"开始测量"后在此区域拖拽</span>}
        {stage === 'measuring' && (
          <div className="text-center">
            <span className="text-lime-400 text-sm font-medium">按住拖拽鼠标</span>
            <p className="text-xs text-slate-500 mt-1">像素距离: {pixelDist}px</p>
          </div>
        )}
        {stage === 'done' && (
          <div className="text-center">
            <span className="text-lime-400 text-2xl font-bold">{dpi} DPI</span>
            <p className="text-xs text-slate-500 mt-1">{pixelDist}px / {physicalDist}mm</p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {stage === 'idle' && (
          <button onClick={startMeasure} className="flex-1 px-4 py-2.5 bg-lime-500/20 border border-lime-500/30 text-lime-400 rounded-lg hover:bg-lime-500/30 transition-all text-sm font-medium">
            开始测量
          </button>
        )}
        {stage === 'measuring' && (
          <button onClick={calculateDpi} disabled={pixelDist === 0} className="flex-1 px-4 py-2.5 bg-lime-500/20 border border-lime-500/30 text-lime-400 rounded-lg hover:bg-lime-500/30 transition-all text-sm font-medium disabled:opacity-50">
            计算 DPI
          </button>
        )}
        {stage === 'done' && (
          <button onClick={startMeasure} className="flex-1 px-4 py-2.5 bg-lime-500/20 border border-lime-500/30 text-lime-400 rounded-lg hover:bg-lime-500/30 transition-all text-sm font-medium">
            重新测量
          </button>
        )}
      </div>

      {/* Common DPI values */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
        <p className="text-xs text-slate-500 mb-2">常见鼠标DPI参考值</p>
        <div className="flex flex-wrap gap-1.5">
          {[400, 800, 1200, 1600, 2400, 3200, 6400, 12000, 25600].map(d => (
            <span key={d} className={`text-xs px-2 py-1 rounded-full border ${
              Math.abs(dpi - d) < d * 0.1
                ? 'bg-lime-500/20 text-lime-400 border-lime-500/30'
                : 'bg-slate-700/30 text-slate-500 border-slate-700'
            }`}>
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DpiAnalyzer;
