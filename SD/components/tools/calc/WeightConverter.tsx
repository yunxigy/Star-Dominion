import React, { useState, useEffect } from 'react';
import { TextInput, ResultBox } from '../shared';

interface Unit {
  name: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const units: Unit[] = [
  { name: '毫克 (mg)', toBase: v => v / 1000000, fromBase: v => v * 1000000 },
  { name: '克 (g)', toBase: v => v / 1000, fromBase: v => v * 1000 },
  { name: '千克 (kg)', toBase: v => v, fromBase: v => v },
  { name: '吨 (t)', toBase: v => v * 1000, fromBase: v => v / 1000 },
  { name: '盎司 (oz)', toBase: v => v * 0.0283495, fromBase: v => v / 0.0283495 },
  { name: '磅 (lb)', toBase: v => v * 0.453592, fromBase: v => v / 0.453592 },
  { name: '斤', toBase: v => v * 0.5, fromBase: v => v * 2 },
  { name: '两', toBase: v => v * 0.05, fromBase: v => v * 20 },
];

const WeightConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [inputValue, setInputValue] = useState('');
  const [fromUnit, setFromUnit] = useState(2);
  const [toUnit, setToUnit] = useState(6);
  const [results, setResults] = useState<{ name: string; value: string }[]>([]);

  useEffect(() => {
    const v = parseFloat(inputValue);
    if (isNaN(v)) { setResults([]); return; }
    const base = units[fromUnit].toBase(v);
    const converted = units[toUnit].fromBase(base);
    setResults([
      { name: units[toUnit].name, value: converted.toPrecision(10).replace(/\.?0+$/, '') },
    ]);
  }, [inputValue, fromUnit, toUnit]);

  const showAll = () => {
    const v = parseFloat(inputValue);
    if (isNaN(v)) return;
    const base = units[fromUnit].toBase(v);
    setResults(units.map(u => ({
      name: u.name,
      value: u.fromBase(base).toPrecision(10).replace(/\.?0+$/, ''),
    })));
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">输入值</label>
        <TextInput value={inputValue} onChange={setInputValue} placeholder="请输入数值" type="number" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">从</label>
          <select
            value={fromUnit}
            onChange={e => setFromUnit(Number(e.target.value))}
            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
          >
            {units.map((u, i) => <option key={i} value={i}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">到</label>
          <select
            value={toUnit}
            onChange={e => setToUnit(Number(e.target.value))}
            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
          >
            {units.map((u, i) => <option key={i} value={i}>{u.name}</option>)}
          </select>
        </div>
      </div>
      <button
        onClick={showAll}
        className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
      >
        显示所有单位换算
      </button>
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

export default WeightConverter;
