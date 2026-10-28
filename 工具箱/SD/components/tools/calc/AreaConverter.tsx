import React, { useState, useEffect } from 'react';
import { TextInput, ResultBox } from '../shared';

interface Unit {
  name: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const units: Unit[] = [
  { name: '平方毫米 (mm²)', toBase: v => v / 1000000, fromBase: v => v * 1000000 },
  { name: '平方厘米 (cm²)', toBase: v => v / 10000, fromBase: v => v * 10000 },
  { name: '平方米 (m²)', toBase: v => v, fromBase: v => v },
  { name: '平方千米 (km²)', toBase: v => v * 1000000, fromBase: v => v / 1000000 },
  { name: '公顷 (ha)', toBase: v => v * 10000, fromBase: v => v / 10000 },
  { name: '亩', toBase: v => v * 666.6667, fromBase: v => v / 666.6667 },
  { name: '平方英里 (mi²)', toBase: v => v * 2589988.11, fromBase: v => v / 2589988.11 },
  { name: '英亩 (ac)', toBase: v => v * 4046.856, fromBase: v => v / 4046.856 },
];

const AreaConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [inputValue, setInputValue] = useState('');
  const [fromUnit, setFromUnit] = useState(2);
  const [toUnit, setToUnit] = useState(5);
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

export default AreaConverter;
