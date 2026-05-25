import React, { useState } from 'react';
import { TextInput, Btn, copyToClipboard } from '../shared';

const UuidGenerator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [uuids, setUuids] = useState<string[]>([crypto.randomUUID()]);
  const [count, setCount] = useState('1');

  const generate = () => {
    const n = Math.min(Math.max(Number(count) || 1, 1), 100);
    setUuids(Array.from({ length: n }, () => crypto.randomUUID()));
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <TextInput value={count} onChange={setCount} placeholder="数量" className="w-24" />
        <Btn onClick={generate}>生成</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      <div className="space-y-1">
        {uuids.map((u, i) => (
          <div key={i} className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
            <span className="text-sm font-mono text-slate-200 flex-1 break-all">{u}</span>
            <button onClick={() => copyToClipboard(u)} className="text-xs text-violet-400 hover:text-violet-300 shrink-0">复制</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default UuidGenerator;
