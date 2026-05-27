import React, { useState } from 'react';
import { TextInput, Btn } from '../shared';

const RandomNumber: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [min, setMin] = useState('1');
  const [max, setMax] = useState('100');
  const [count, setCount] = useState('1');
  const [results, setResults] = useState<number[]>([]);

  const generate = () => {
    const lo = Number(min);
    const hi = Number(max);
    const n = Math.min(Math.max(Number(count) || 1, 1), 100);
    if (isNaN(lo) || isNaN(hi) || lo >= hi) return;
    const nums: number[] = [];
    for (let i = 0; i < n; i++) {
      nums.push(Math.floor(Math.random() * (hi - lo + 1)) + lo);
    }
    setResults(nums);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center flex-wrap">
        <TextInput value={min} onChange={setMin} placeholder="最小值" type="number" className="w-24" />
        <span className="text-slate-400">-</span>
        <TextInput value={max} onChange={setMax} placeholder="最大值" type="number" className="w-24" />
        <TextInput value={count} onChange={setCount} placeholder="数量" type="number" className="w-20" />
        <Btn onClick={generate}>生成</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {results.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {results.map((num, i) => (
            <div
              key={i}
              className="bg-pink-400/10 border border-pink-400/20 rounded-lg p-3 text-center text-pink-400 font-mono text-lg font-bold"
            >
              {num}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RandomNumber;
