import React, { useState } from 'react';
import { Btn, TextInput, ResultBox } from '../shared';

type Mode = 'ratio' | 'percent' | 'increase' | 'decrease';

const PercentageCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [mode, setMode] = useState<Mode>('ratio');
  const [valA, setValA] = useState('');
  const [valB, setValB] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const modes: { key: Mode; label: string }[] = [
    { key: 'ratio', label: 'A是B的百分之几' },
    { key: 'percent', label: 'A的X%是多少' },
    { key: 'increase', label: 'A增加X%' },
    { key: 'decrease', label: 'A减少X%' },
  ];

  const calculate = () => {
    const a = parseFloat(valA);
    const b = parseFloat(valB);
    if (isNaN(a) || isNaN(b)) return;

    switch (mode) {
      case 'ratio':
        if (b === 0) return;
        setResult(`${((a / b) * 100).toFixed(2)}%`);
        break;
      case 'percent':
        setResult(`${(a * b / 100).toFixed(2)}`);
        break;
      case 'increase':
        setResult(`${(a * (1 + b / 100)).toFixed(2)}`);
        break;
      case 'decrease':
        setResult(`${(a * (1 - b / 100)).toFixed(2)}`);
        break;
    }
  };

  const labelB = mode === 'ratio' ? 'B 的值' : '百分比 (%)';

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">计算类型</label>
        <div className="grid grid-cols-2 gap-2">
          {modes.map(m => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setResult(null); }}
              className={`py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                mode === m.key ? 'bg-violet-600 text-white' : 'bg-slate-800/50 text-slate-400 border border-slate-700'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">A 的值</label>
        <TextInput value={valA} onChange={setValA} placeholder="请输入数值" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">{labelB}</label>
        <TextInput value={valB} onChange={setValB} placeholder="请输入数值" type="number" />
      </div>
      <Btn onClick={calculate} variant="primary">计算</Btn>
      {result !== null && (
        <ResultBox label="结果" value={result} onCopy={() => navigator.clipboard.writeText(result)} />
      )}
    </div>
  );
};

export default PercentageCalculator;
