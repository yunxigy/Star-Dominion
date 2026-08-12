import React, { useState, useMemo } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { ArrowRightLeft, Copy, CheckCircle } from 'lucide-react';

type Category = 'length' | 'weight' | 'temperature' | 'area' | 'volume' | 'speed' | 'data' | 'time' | 'pressure' | 'energy';

interface UnitDef {
  name: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const CATEGORIES: { id: Category; name: string; icon: string }[] = [
  { id: 'length', name: '长度', icon: '📏' },
  { id: 'weight', name: '重量', icon: '⚖️' },
  { id: 'temperature', name: '温度', icon: '🌡️' },
  { id: 'area', name: '面积', icon: '📐' },
  { id: 'volume', name: '体积', icon: '🧊' },
  { id: 'speed', name: '速度', icon: '🚀' },
  { id: 'data', name: '数据存储', icon: '💾' },
  { id: 'time', name: '时间', icon: '⏱️' },
  { id: 'pressure', name: '压力', icon: '🔧' },
  { id: 'energy', name: '能量', icon: '⚡' },
];

const UNITS: Record<Category, UnitDef[]> = {
  length: [
    { name: '毫米 (mm)', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { name: '厘米 (cm)', toBase: v => v / 100, fromBase: v => v * 100 },
    { name: '米 (m)', toBase: v => v, fromBase: v => v },
    { name: '千米 (km)', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { name: '英寸 (in)', toBase: v => v * 0.0254, fromBase: v => v / 0.0254 },
    { name: '英尺 (ft)', toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
    { name: '英里 (mi)', toBase: v => v * 1609.344, fromBase: v => v / 1609.344 },
    { name: '海里 (nmi)', toBase: v => v * 1852, fromBase: v => v / 1852 },
    { name: '市尺', toBase: v => v / 3, fromBase: v => v * 3 },
    { name: '市里', toBase: v => v * 500, fromBase: v => v / 500 },
  ],
  weight: [
    { name: '毫克 (mg)', toBase: v => v / 1e6, fromBase: v => v * 1e6 },
    { name: '克 (g)', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { name: '千克 (kg)', toBase: v => v, fromBase: v => v },
    { name: '吨 (t)', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { name: '磅 (lb)', toBase: v => v * 0.453592, fromBase: v => v / 0.453592 },
    { name: '盎司 (oz)', toBase: v => v * 0.0283495, fromBase: v => v / 0.0283495 },
    { name: '斤', toBase: v => v * 0.5, fromBase: v => v / 0.5 },
    { name: '两', toBase: v => v * 0.05, fromBase: v => v / 0.05 },
  ],
  temperature: [
    { name: '摄氏度 (°C)', toBase: v => v, fromBase: v => v },
    { name: '华氏度 (°F)', toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32 },
    { name: '开尔文 (K)', toBase: v => v - 273.15, fromBase: v => v + 273.15 },
  ],
  area: [
    { name: '平方厘米 (cm²)', toBase: v => v / 1e4, fromBase: v => v * 1e4 },
    { name: '平方米 (m²)', toBase: v => v, fromBase: v => v },
    { name: '平方千米 (km²)', toBase: v => v * 1e6, fromBase: v => v / 1e6 },
    { name: '公顷 (ha)', toBase: v => v * 1e4, fromBase: v => v / 1e4 },
    { name: '亩', toBase: v => v * 666.667, fromBase: v => v / 666.667 },
    { name: '平方英尺 (ft²)', toBase: v => v * 0.092903, fromBase: v => v / 0.092903 },
    { name: '英亩 (ac)', toBase: v => v * 4046.86, fromBase: v => v / 4046.86 },
  ],
  volume: [
    { name: '毫升 (mL)', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { name: '升 (L)', toBase: v => v, fromBase: v => v },
    { name: '立方米 (m³)', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { name: '加仑 (US gal)', toBase: v => v * 3.78541, fromBase: v => v / 3.78541 },
    { name: '品脱 (US pt)', toBase: v => v * 0.473176, fromBase: v => v / 0.473176 },
    { name: '杯 (cup)', toBase: v => v * 0.236588, fromBase: v => v / 0.236588 },
  ],
  speed: [
    { name: '米/秒 (m/s)', toBase: v => v, fromBase: v => v },
    { name: '千米/时 (km/h)', toBase: v => v / 3.6, fromBase: v => v * 3.6 },
    { name: '英里/时 (mph)', toBase: v => v * 0.44704, fromBase: v => v / 0.44704 },
    { name: '节 (knot)', toBase: v => v * 0.514444, fromBase: v => v / 0.514444 },
    { name: '马赫 (Mach)', toBase: v => v * 340.29, fromBase: v => v / 340.29 },
  ],
  data: [
    { name: '字节 (B)', toBase: v => v, fromBase: v => v },
    { name: 'KB', toBase: v => v * 1024, fromBase: v => v / 1024 },
    { name: 'MB', toBase: v => v * 1048576, fromBase: v => v / 1048576 },
    { name: 'GB', toBase: v => v * 1073741824, fromBase: v => v / 1073741824 },
    { name: 'TB', toBase: v => v * 1099511627776, fromBase: v => v / 1099511627776 },
    { name: '比特 (bit)', toBase: v => v / 8, fromBase: v => v * 8 },
  ],
  time: [
    { name: '毫秒 (ms)', toBase: v => v / 1000, fromBase: v => v * 1000 },
    { name: '秒 (s)', toBase: v => v, fromBase: v => v },
    { name: '分钟 (min)', toBase: v => v * 60, fromBase: v => v / 60 },
    { name: '小时 (h)', toBase: v => v * 3600, fromBase: v => v / 3600 },
    { name: '天 (d)', toBase: v => v * 86400, fromBase: v => v / 86400 },
    { name: '周 (wk)', toBase: v => v * 604800, fromBase: v => v / 604800 },
    { name: '年 (yr)', toBase: v => v * 31536000, fromBase: v => v / 31536000 },
  ],
  pressure: [
    { name: '帕斯卡 (Pa)', toBase: v => v, fromBase: v => v },
    { name: '千帕 (kPa)', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { name: '巴 (bar)', toBase: v => v * 1e5, fromBase: v => v / 1e5 },
    { name: '大气压 (atm)', toBase: v => v * 101325, fromBase: v => v / 101325 },
    { name: 'mmHg', toBase: v => v * 133.322, fromBase: v => v / 133.322 },
    { name: 'psi', toBase: v => v * 6894.76, fromBase: v => v / 6894.76 },
  ],
  energy: [
    { name: '焦耳 (J)', toBase: v => v, fromBase: v => v },
    { name: '千焦 (kJ)', toBase: v => v * 1000, fromBase: v => v / 1000 },
    { name: '卡路里 (cal)', toBase: v => v * 4.184, fromBase: v => v / 4.184 },
    { name: '千卡 (kcal)', toBase: v => v * 4184, fromBase: v => v / 4184 },
    { name: '瓦时 (Wh)', toBase: v => v * 3600, fromBase: v => v / 3600 },
    { name: '千瓦时 (kWh)', toBase: v => v * 3600000, fromBase: v => v / 3600000 },
    { name: 'BTU', toBase: v => v * 1055.06, fromBase: v => v / 1055.06 },
  ],
};

const UnitConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [category, setCategory] = useState<Category>('length');
  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [fromVal, setFromVal] = useState('1');
  const [copied, setCopied] = useState(false);

  const units = UNITS[category];

  const toVal = useMemo(() => {
    const v = parseFloat(fromVal);
    if (isNaN(v)) return '';
    const base = units[fromIdx].toBase(v);
    return units[toIdx].fromBase(base).toPrecision(10).replace(/\.?0+$/, '');
  }, [fromVal, fromIdx, toIdx, units]);

  const handleSwap = () => {
    setFromIdx(toIdx);
    setToIdx(fromIdx);
    setFromVal(toVal);
  };

  const handleCopy = async () => {
    if (!toVal) return;
    await copyToClipboard(toVal);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">单位换算器 — 10种分类、常用单位互转</p>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map(cat => (
          <button key={cat.id} onClick={() => { setCategory(cat.id); setFromIdx(0); setToIdx(1); setFromVal('1'); }}
            className={`px-2 py-1 text-[10px] rounded-full border transition-colors
              ${category === cat.id ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad] hover:bg-[#fff4e6]'}`}>
            {cat.icon} {cat.name}
          </button>
        ))}
      </div>

      {/* Converter */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3 space-y-3">
        {/* From */}
        <div>
          <label className="text-[10px] text-[#8b735c] mb-1 block">从</label>
          <div className="flex gap-2">
            <input type="number" value={fromVal} onChange={e => setFromVal(e.target.value)}
              className="flex-1 text-sm border border-[#ead0ad] rounded-lg px-3 py-2 bg-white focus:border-[#7a421b] focus:outline-none font-mono" />
            <select value={fromIdx} onChange={e => setFromIdx(+e.target.value)}
              className="text-xs border border-[#ead0ad] rounded-lg px-2 py-1 bg-white min-w-[120px]">
              {units.map((u, i) => <option key={i} value={i}>{u.name}</option>)}
            </select>
          </div>
        </div>

        {/* Swap button */}
        <div className="flex justify-center">
          <button onClick={handleSwap}
            className="p-2 rounded-full bg-[#7a421b] text-white hover:bg-[#6f3714] transition-colors">
            <ArrowRightLeft className="w-4 h-4" />
          </button>
        </div>

        {/* To */}
        <div>
          <label className="text-[10px] text-[#8b735c] mb-1 block">到</label>
          <div className="flex gap-2">
            <div className="flex-1 text-sm border border-[#ead0ad] rounded-lg px-3 py-2 bg-white font-mono text-[#6d5a47]">
              {toVal || '-'}
            </div>
            <select value={toIdx} onChange={e => setToIdx(+e.target.value)}
              className="text-xs border border-[#ead0ad] rounded-lg px-2 py-1 bg-white min-w-[120px]">
              {units.map((u, i) => <option key={i} value={i}>{u.name}</option>)}
            </select>
          </div>
        </div>

        {/* Copy result */}
        {toVal && (
          <div className="flex justify-end">
            <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-[#7a421b] hover:text-[#6f3714]">
              {copied ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              复制结果
            </button>
          </div>
        )}
      </div>

      {/* Quick reference table */}
      <div className="border border-[#ead0ad] rounded-lg p-3">
        <div className="text-xs font-medium text-[#6f3714] mb-2">快速参考</div>
        <div className="space-y-1 text-xs">
          {units.filter((_, i) => i !== fromIdx).slice(0, 6).map((u, i) => {
            const v = parseFloat(fromVal);
            if (isNaN(v)) return null;
            const base = units[fromIdx].toBase(v);
            const result = u.fromBase(base);
            return (
              <div key={i} className="flex justify-between text-[#6d5a47]">
                <span className="font-mono">{fromVal} {units[fromIdx].name}</span>
                <span className="text-[#8b735c]">=</span>
                <span className="font-mono">{result.toPrecision(6).replace(/\.?0+$/, '')} {u.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default UnitConverter;