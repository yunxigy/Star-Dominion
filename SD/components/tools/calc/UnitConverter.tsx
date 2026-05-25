import React, { useState, useEffect } from 'react';
import { TextInput, ResultBox } from '../shared';

type Category = 'length' | 'weight' | 'temperature' | 'area' | 'speed' | 'time';

interface UnitDef {
  name: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const categories: { key: Category; label: string }[] = [
  { key: 'length', label: '长度' },
  { key: 'weight', label: '重量' },
  { key: 'temperature', label: '温度' },
  { key: 'area', label: '面积' },
  { key: 'speed', label: '速度' },
  { key: 'time', label: '时间' },
];

const unitMap: Record<Category, { name: string; units: UnitDef[] }> = {
  length: {
    name: '长度',
    units: [
      { name: '毫米 (mm)', toBase: v => v / 1000, fromBase: v => v * 1000 },
      { name: '厘米 (cm)', toBase: v => v / 100, fromBase: v => v * 100 },
      { name: '米 (m)', toBase: v => v, fromBase: v => v },
      { name: '千米 (km)', toBase: v => v * 1000, fromBase: v => v / 1000 },
      { name: '英寸 (in)', toBase: v => v * 0.0254, fromBase: v => v / 0.0254 },
      { name: '英尺 (ft)', toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
      { name: '英里 (mi)', toBase: v => v * 1609.344, fromBase: v => v / 1609.344 },
      { name: '海里 (nmi)', toBase: v => v * 1852, fromBase: v => v / 1852 },
    ],
  },
  weight: {
    name: '重量',
    units: [
      { name: '毫克 (mg)', toBase: v => v / 1000000, fromBase: v => v * 1000000 },
      { name: '克 (g)', toBase: v => v / 1000, fromBase: v => v * 1000 },
      { name: '千克 (kg)', toBase: v => v, fromBase: v => v },
      { name: '吨 (t)', toBase: v => v * 1000, fromBase: v => v / 1000 },
      { name: '盎司 (oz)', toBase: v => v * 0.0283495, fromBase: v => v / 0.0283495 },
      { name: '磅 (lb)', toBase: v => v * 0.453592, fromBase: v => v / 0.453592 },
      { name: '斤', toBase: v => v * 0.5, fromBase: v => v * 2 },
      { name: '两', toBase: v => v * 0.05, fromBase: v => v * 20 },
    ],
  },
  temperature: {
    name: '温度',
    units: [
      { name: '摄氏度 (°C)', toBase: v => v, fromBase: v => v },
      { name: '华氏度 (°F)', toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32 },
      { name: '开尔文 (K)', toBase: v => v - 273.15, fromBase: v => v + 273.15 },
    ],
  },
  area: {
    name: '面积',
    units: [
      { name: '平方毫米 (mm²)', toBase: v => v / 1000000, fromBase: v => v * 1000000 },
      { name: '平方厘米 (cm²)', toBase: v => v / 10000, fromBase: v => v * 10000 },
      { name: '平方米 (m²)', toBase: v => v, fromBase: v => v },
      { name: '平方千米 (km²)', toBase: v => v * 1000000, fromBase: v => v / 1000000 },
      { name: '公顷 (ha)', toBase: v => v * 10000, fromBase: v => v / 10000 },
      { name: '亩', toBase: v => v * 666.6667, fromBase: v => v / 666.6667 },
      { name: '平方英里 (mi²)', toBase: v => v * 2589988.11, fromBase: v => v / 2589988.11 },
      { name: '英亩 (ac)', toBase: v => v * 4046.856, fromBase: v => v / 4046.856 },
    ],
  },
  speed: {
    name: '速度',
    units: [
      { name: '米/秒 (m/s)', toBase: v => v, fromBase: v => v },
      { name: '千米/时 (km/h)', toBase: v => v / 3.6, fromBase: v => v * 3.6 },
      { name: '英里/时 (mph)', toBase: v => v * 0.44704, fromBase: v => v / 0.44704 },
      { name: '节 (kn)', toBase: v => v * 0.514444, fromBase: v => v / 0.514444 },
      { name: '马赫 (Ma)', toBase: v => v * 340.3, fromBase: v => v / 340.3 },
    ],
  },
  time: {
    name: '时间',
    units: [
      { name: '毫秒 (ms)', toBase: v => v / 1000, fromBase: v => v * 1000 },
      { name: '秒 (s)', toBase: v => v, fromBase: v => v },
      { name: '分 (min)', toBase: v => v * 60, fromBase: v => v / 60 },
      { name: '时 (h)', toBase: v => v * 3600, fromBase: v => v / 3600 },
      { name: '天 (d)', toBase: v => v * 86400, fromBase: v => v / 86400 },
      { name: '周 (wk)', toBase: v => v * 604800, fromBase: v => v / 604800 },
      { name: '月 (mo)', toBase: v => v * 2592000, fromBase: v => v / 2592000 },
      { name: '年 (yr)', toBase: v => v * 31536000, fromBase: v => v / 31536000 },
    ],
  },
};

const UnitConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [category, setCategory] = useState<Category>('length');
  const [inputValue, setInputValue] = useState('');
  const [fromUnit, setFromUnit] = useState(0);
  const [toUnit, setToUnit] = useState(1);
  const [result, setResult] = useState<string>('');

  const units = unitMap[category].units;

  useEffect(() => {
    setFromUnit(0);
    setToUnit(1);
    setInputValue('');
    setResult('');
  }, [category]);

  useEffect(() => {
    const v = parseFloat(inputValue);
    if (isNaN(v)) { setResult(''); return; }
    const base = units[fromUnit].toBase(v);
    const converted = units[toUnit].fromBase(base);
    setResult(converted.toPrecision(10).replace(/\.?0+$/, ''));
  }, [inputValue, fromUnit, toUnit, units]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">换算类别</label>
        <div className="grid grid-cols-3 gap-2">
          {categories.map(c => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`py-2 rounded-lg text-xs font-medium transition-all ${
                category === c.key ? 'bg-violet-600 text-white' : 'bg-slate-800/50 text-slate-400 border border-slate-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
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
      {result && (
        <ResultBox label="换算结果" value={`${result} ${units[toUnit].name}`} onCopy={() => navigator.clipboard.writeText(result)} />
      )}
    </div>
  );
};

export default UnitConverter;
