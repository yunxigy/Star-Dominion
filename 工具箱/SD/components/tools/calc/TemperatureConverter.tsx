import React, { useState, useEffect } from 'react';
import { TextInput, ResultBox } from '../shared';

interface Unit {
  name: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const units: Unit[] = [
  { name: '摄氏度 (°C)', toBase: v => v, fromBase: v => v },
  { name: '华氏度 (°F)', toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32 },
  { name: '开尔文 (K)', toBase: v => v - 273.15, fromBase: v => v + 273.15 },
];

const TemperatureConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [inputValue, setInputValue] = useState('');
  const [fromUnit, setFromUnit] = useState(0);
  const [toUnit, setToUnit] = useState(1);
  const [results, setResults] = useState<{ name: string; value: string }[]>([]);

  useEffect(() => {
    const v = parseFloat(inputValue);
    if (isNaN(v)) { setResults([]); return; }
    // 显示所有单位
    const base = units[fromUnit].toBase(v);
    setResults(units.map(u => ({
      name: u.name,
      value: u.fromBase(base).toFixed(2),
    })));
  }, [inputValue, fromUnit]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">输入值</label>
        <TextInput value={inputValue} onChange={setInputValue} placeholder="请输入温度值" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">输入单位</label>
        <div className="flex gap-2">
          {units.map((u, i) => (
            <button
              key={i}
              onClick={() => setFromUnit(i)}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                fromUnit === i ? 'bg-violet-600 text-white' : 'bg-slate-800/50 text-slate-400 border border-slate-700'
              }`}
            >
              {u.name}
            </button>
          ))}
        </div>
      </div>
      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <ResultBox key={i} label={r.name} value={r.value} onCopy={() => navigator.clipboard.writeText(r.value)} />
          ))}
        </div>
      )}
    </div>
  );
};

export default TemperatureConverter;
