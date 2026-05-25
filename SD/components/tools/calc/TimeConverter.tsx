import React, { useState, useEffect } from 'react';
import { TextInput, ResultBox } from '../shared';

interface Unit {
  name: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const units: Unit[] = [
  { name: '毫秒 (ms)', toBase: v => v / 1000, fromBase: v => v * 1000 },
  { name: '秒 (s)', toBase: v => v, fromBase: v => v },
  { name: '分 (min)', toBase: v => v * 60, fromBase: v => v / 60 },
  { name: '时 (h)', toBase: v => v * 3600, fromBase: v => v / 3600 },
  { name: '天 (d)', toBase: v => v * 86400, fromBase: v => v / 86400 },
  { name: '周 (wk)', toBase: v => v * 604800, fromBase: v => v / 604800 },
  { name: '月 (mo)', toBase: v => v * 2592000, fromBase: v => v / 2592000 },
  { name: '年 (yr)', toBase: v => v * 31536000, fromBase: v => v / 31536000 },
];

const TimeConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [inputValue, setInputValue] = useState('');
  const [fromUnit, setFromUnit] = useState(1);
  const [toUnit, setToUnit] = useState(2);
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

export default TimeConverter;
