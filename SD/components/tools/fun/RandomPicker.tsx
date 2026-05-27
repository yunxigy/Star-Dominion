import React, { useState, useRef } from 'react';
import { TextArea, Btn } from '../shared';

const RandomPicker: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [options, setOptions] = useState('');
  const [selected, setSelected] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pick = () => {
    const items = options.split('\n').map(s => s.trim()).filter(Boolean);
    if (items.length === 0) return;

    setSpinning(true);
    setSelected('');
    let tick = 0;
    const totalTicks = 25;

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setDisplay(items[Math.floor(Math.random() * items.length)]);
      tick++;
      if (tick >= totalTicks) {
        clearInterval(timerRef.current!);
        timerRef.current = null;
        const final = items[Math.floor(Math.random() * items.length)];
        setSelected(final);
        setHistory(prev => [final, ...prev].slice(0, 20));
        setDisplay('');
        setSpinning(false);
      }
    }, 80);
  };

  const clearHistory = () => setHistory([]);

  return (
    <div className="space-y-3">
      <TextArea
        value={options}
        onChange={setOptions}
        placeholder={'输入选项，每行一个\n例如：\n选项A\n选项B\n选项C'}
        rows={6}
      />
      <div className="flex gap-2 items-center">
        <Btn onClick={pick} disabled={spinning}>
          {spinning ? '选择中...' : '随机选择'}
        </Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>

      {spinning && (
        <div className="text-center py-8">
          <div className="text-4xl font-bold text-pink-400 animate-pulse">{display}</div>
        </div>
      )}

      {selected && !spinning && (
        <div className="text-center py-6 bg-pink-400/5 border border-pink-400/20 rounded-xl">
          <div className="text-sm text-slate-400 mb-2">随机结果</div>
          <div className="text-3xl font-bold text-pink-400">{selected}</div>
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">历史记录</span>
            <button onClick={clearHistory} className="text-xs text-slate-500 hover:text-slate-400">清除</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {history.map((h, i) => (
              <span
                key={i}
                className={`px-2 py-1 rounded text-xs ${
                  i === 0
                    ? 'bg-pink-400/10 border border-pink-400/30 text-pink-400'
                    : 'bg-slate-800/50 border border-slate-700 text-slate-400'
                }`}
              >
                {h}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RandomPicker;
